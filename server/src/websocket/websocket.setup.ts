import { Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Socket } from 'net';
import { parse } from 'cookie';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import {
  WebSocketService,
  BroadcastFunction,
} from './services/websocket.service';
import { WebSocketController } from './controllers/websocket.controller';
import { MessageService } from '../messenger/services/message.service';
import { redisClient } from '../config/redis';
import config from '../config/config';

interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
}

export let webSocketServiceInstance: WebSocketService;
let broadcastFunction: BroadcastFunction;

async function checkRateLimit(userId: string): Promise<boolean> {
  const key = `ws:rate:${userId}`;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 10);
  return count <= 50;
}

// ─── Cookie-based auth at upgrade ────────────────────────────────────────────
function verifyUpgradeRequest(
  request: IncomingMessage,
  socket: Socket,
): string | null {
  try {
    // Origin check — prevent Cross-Site WebSocket Hijacking
    const origin = request.headers.origin;
    if (origin && origin !== config.clientUrl) {
      logger.warn(`WS upgrade rejected: bad origin ${origin}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return null;
    }

    // Cookies are automatically sent on the HTTP upgrade request
    const cookies = parse(request.headers.cookie || '');
    const token = cookies['accessToken'];

    if (!token) {
      logger.warn('WS upgrade rejected: no auth cookie');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return null;
    }

    const decoded = jwt.verify(token, config.jwtSecret) as {
      sub?: string;
      userId?: string;
    };
    const userId = decoded.sub ?? decoded.userId;

    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return null;
    }

    return userId;
  } catch (err) {
    logger.warn('WS upgrade rejected: invalid token', err);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return null;
  }
}

function startHeartbeat(wss: WebSocketServer): NodeJS.Timeout {
  return setInterval(() => {
    wss.clients.forEach((ws) => {
      const client = ws as AuthenticatedWebSocket;
      if (!client.isAlive) {
        logger.debug(`Terminating dead WS for user ${client.userId}`);
        return client.terminate();
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30_000);
}

export const setupWebSocket = (server: Server): void => {
  const wss = new WebSocketServer({ noServer: true });
  const webSocketService = new WebSocketService();
  webSocketServiceInstance = webSocketService;

  const messageService = new MessageService(webSocketService.broadcast);
  const webSocketController = new WebSocketController(
    webSocketService,
    messageService,
  );
  broadcastFunction = webSocketService.broadcast;

  // subscribe to upload events published by worker process
  const uploadSubscriber = redisClient.duplicate();
  uploadSubscriber
    .connect()
    .then(() => {
      uploadSubscriber.subscribe('ws:upload', (message) => {
        try {
          const { userId, payload } = JSON.parse(message);
          webSocketService.sendToUser(userId, payload);
        } catch (err) {
          logger.error('Failed to handle ws:upload event:', err);
        }
      });
    })
    .catch((err) => {
      logger.error('Failed to connect upload subscriber:', err);
    });

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const userId = verifyUpgradeRequest(request, socket);
      if (!userId) return;

      wss.handleUpgrade(request, socket, head, (ws) => {
        const client = ws as AuthenticatedWebSocket;
        client.userId = userId;
        client.isAlive = true;
        wss.emit('connection', client, request);
      });
    },
  );

  const heartbeatTimer = startHeartbeat(wss);

  wss.on('connection', (ws: AuthenticatedWebSocket) => {
    logger.info(`User ${ws.userId} connected via WebSocket.`);

    webSocketService
      .authenticate(ws.userId, ws)
      .catch((err) => logger.error('WS auth registration error:', err));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (rawMessage: Buffer) => {
      try {
        const allowed = await checkRateLimit(ws.userId);
        if (!allowed) {
          logger.warn(`WS rate limit hit for user ${ws.userId}`);
          return;
        }

        const messageData = JSON.parse(rawMessage.toString());

        if (messageData.type === 'authenticate') return;

        if (messageData.message?.sender)
          messageData.message.sender._id = ws.userId;
        if (messageData.user_id) messageData.user_id = ws.userId;

        webSocketController.handleIncomingMessage(ws, messageData);
      } catch (error) {
        logger.error('Invalid WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      webSocketController.handleDisconnect(ws);
    });
    ws.on('error', (error) => {
      logger.error(`WebSocket error for user ${ws.userId}:`, error);
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    uploadSubscriber.unsubscribe('ws:upload').catch(() => {});
    uploadSubscriber.destroy();
  });

  logger.info('WebSocket server initialized.');
};

export const getBroadcastFunction = (): BroadcastFunction => {
  if (!broadcastFunction)
    throw new Error('WebSocket service has not been initialized yet.');
  return broadcastFunction;
};

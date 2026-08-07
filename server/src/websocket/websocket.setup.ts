import { Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Socket } from 'net';
import { parse } from 'cookie';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../auth/services/jwt.service';
import {
  isAccessTokenBlacklisted,
  isSessionRevoked,
} from '../auth/services/token.service';
import {
  WebSocketService,
  BroadcastFunction,
} from './services/websocket.service';
import { WebSocketController } from './controllers/websocket.controller';
import { redisClient } from '../config/redis';
import config from '../config/config';
import {
  WS_RATE_WINDOW_SECONDS,
  checkRateLimit,
} from './services/ws-rate-limit';

export interface AuthenticatedWebSocket extends WebSocket {
  userId: string;
  isAlive: boolean;
  /**
   * When the token that opened this socket expires (unix seconds). A socket is
   * authorised once, at the handshake; without this it outlives the credential
   * that opened it and stays authenticated indefinitely.
   */
  expiresAt: number;
  /**
   * When that token was issued (unix seconds), and which session it belongs
   * to. Both are needed to answer "was this socket opened before the user
   * signed out everywhere?" — the handshake is the only time it is asked
   * otherwise, and a revocation arrives long after it.
   */
  issuedAt: number;
  sid?: string;
  /**
   * When this socket was last told a given message type was being dropped.
   * Answering every over-budget frame would double the traffic of exactly the
   * client that is already sending too much.
   */
  rateLimitNoticeAt: Map<string, number>;
}

/** Close code for "your token expired, reconnect with a fresh one". */
const CLOSE_TOKEN_EXPIRED = 4001;

export let webSocketServiceInstance: WebSocketService;
let broadcastFunction: BroadcastFunction;
let closeServer: (() => Promise<void>) | undefined;

/** Close code for "the server is going away", distinct from an expired token. */
const CLOSE_SERVER_SHUTDOWN = 1001;

/**
 * Tells the client its frame was dropped, and when to try again.
 *
 * The limiter used to just `return`, so a client over budget watched its typing
 * indicators, read receipts and presence updates vanish with nothing said. An
 * unread badge that never clears looks like a server fault from the outside,
 * and there was nothing in the protocol to say otherwise.
 */
function notifyRateLimited(
  ws: AuthenticatedWebSocket,
  messageType: string,
  retryAfter: number,
): void {
  const now = Date.now();
  const lastNotified = ws.rateLimitNoticeAt.get(messageType) ?? 0;
  if (now - lastNotified < WS_RATE_WINDOW_SECONDS * 1000) return;
  ws.rateLimitNoticeAt.set(messageType, now);

  logger.warn(
    `WS rate limit hit for user ${ws.userId} on "${messageType}" (${retryAfter}s)`,
  );

  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    JSON.stringify({
      type: 'rate-limited',
      message_type: messageType,
      retry_after: retryAfter,
    }),
  );
}

/** Close code for "the session behind this socket was revoked". */
const CLOSE_SESSION_REVOKED = 4002;

/** The identity and expiry proven at the handshake. */
interface UpgradeIdentity {
  userId: string;
  /** Unix seconds. The socket is closed when the token behind it expires. */
  expiresAt: number;
  /** Unix seconds. Compared against a later revocation. */
  issuedAt: number;
  sid?: string;
}

const rejectUpgrade = (socket: Socket, status: '401' | '403'): null => {
  const reason = status === '401' ? 'Unauthorized' : 'Forbidden';
  socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
  socket.destroy();
  return null;
};

// ─── Cookie-based auth at upgrade ────────────────────────────────────────────
async function verifyUpgradeRequest(
  request: IncomingMessage,
  socket: Socket,
): Promise<UpgradeIdentity | null> {
  try {
    // Origin check — prevent Cross-Site WebSocket Hijacking. A missing Origin
    // is rejected rather than allowed: browsers always send one on a WebSocket
    // handshake, so its absence means the caller is not the app.
    const origin = request.headers.origin;
    if (origin !== config.clientUrl) {
      logger.warn(`WS upgrade rejected: bad origin ${origin ?? '(none)'}`);
      return rejectUpgrade(socket, '403');
    }

    // Cookies are automatically sent on the HTTP upgrade request
    const cookies = parse(request.headers.cookie || '');
    const token = cookies['accessToken'];

    if (!token) {
      logger.warn('WS upgrade rejected: no auth cookie');
      return rejectUpgrade(socket, '401');
    }

    // Type-scoped, exactly as the HTTP path is: the two-factor challenge is
    // signed with the same secret and must not open a socket.
    const decoded = verifyAccessToken(token);
    const userId = decoded.userId;

    if (!userId || !decoded.exp) return rejectUpgrade(socket, '401');

    // A revoked token opened a socket that then stayed authenticated for as
    // long as it was held open — logging out or revoking a session did not
    // close it.
    if (await isAccessTokenBlacklisted(token)) {
      logger.warn(`WS upgrade rejected: revoked token for user ${userId}`);
      return rejectUpgrade(socket, '401');
    }

    // Signing out everywhere refuses tokens by age, because the server never
    // held the ones in other browsers. Without this a revoked device could
    // still open a fresh socket with a token the HTTP layer already refuses.
    if (await isSessionRevoked(decoded)) {
      logger.warn(`WS upgrade rejected: revoked session for user ${userId}`);
      return rejectUpgrade(socket, '401');
    }

    return {
      userId,
      expiresAt: decoded.exp,
      issuedAt: decoded.iat ?? 0,
      sid: decoded.sid,
    };
  } catch (err) {
    logger.warn('WS upgrade rejected: invalid token', err);
    return rejectUpgrade(socket, '401');
  }
}

function startHeartbeat(wss: WebSocketServer): NodeJS.Timeout {
  return setInterval(() => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    wss.clients.forEach((ws) => {
      const client = ws as AuthenticatedWebSocket;

      // The credential that opened this socket has run out. The client holds a
      // fresher cookie by now (the interceptor refreshes on 401) and its
      // reconnect will present it, so this is a rotation rather than a logout.
      if (client.expiresAt && client.expiresAt <= nowSeconds) {
        logger.debug(`Closing expired WS for user ${client.userId}`);
        return client.close(CLOSE_TOKEN_EXPIRED, 'Token expired');
      }

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

  const webSocketController = new WebSocketController(webSocketService);
  broadcastFunction = webSocketService.broadcast;

  /*
   * Presence transitions are held in Redis and finalised by whichever instance
   * sweeps them first, so this has to be running for anyone to be marked
   * offline at all — including the transitions left behind by a process that
   * died before its own would have come due.
   */
  webSocketController.startPresenceSweeper();

  /**
   * Closes any socket on this instance that the revocation covers.
   *
   * A socket is authorised once, at the handshake, so refusing the *next*
   * upgrade is not enough — one already open would keep delivering messages to
   * a device that has been signed out, for as long as its token had left. The
   * comparison is the same one the HTTP layer makes: opened before the
   * revocation, and not the session deliberately kept.
   */
  const closeRevokedSockets = (
    userId: string,
    /** Unix seconds, matching the `iat` the socket was opened with. */
    at: number,
    keepSid?: string,
  ): void => {
    for (const ws of wss.clients) {
      const client = ws as AuthenticatedWebSocket;
      if (client.userId !== userId) continue;
      if (keepSid && client.sid === keepSid) continue;
      if (client.issuedAt >= at) continue;

      logger.info(`Closing revoked WS for user ${userId}`);
      client.close(CLOSE_SESSION_REVOKED, 'Session revoked');
    }
  };

  /**
   * Closes the sockets belonging to one named session, leaving the user's
   * other devices connected.
   *
   * The comparison above cannot express this: it is keyed by user and by time,
   * so evicting one device with it would close every socket the account has.
   * There is no `issuedAt` comparison here either — a session id is minted per
   * login, so any socket carrying it belongs to the session being ended.
   */
  const closeSessionSockets = (userId: string, sid: string): void => {
    for (const ws of wss.clients) {
      const client = ws as AuthenticatedWebSocket;
      if (client.userId !== userId) continue;
      if (client.sid !== sid) continue;

      logger.info(`Closing revoked WS for session ${sid}`);
      client.close(CLOSE_SESSION_REVOKED, 'Session revoked');
    }
  };

  // subscribe to events published by the worker and by the auth layer
  const uploadSubscriber = redisClient.duplicate();
  uploadSubscriber
    .connect()
    .then(async () => {
      await uploadSubscriber.subscribe('ws:upload', (message) => {
        try {
          const { userId, payload } = JSON.parse(message);
          webSocketService.sendToUser(userId, payload);
        } catch (err) {
          logger.error('Failed to handle ws:upload event:', err);
        }
      });

      // Every instance acts on this — the socket to close may be on any of
      // them, and there is nothing to de-duplicate.
      await uploadSubscriber.subscribe('ws:revoke', (message) => {
        try {
          // Two shapes, matching the two ways a session ends: one named
          // session, or everything issued before a moment.
          const { userId, at, keepSid, sid } = JSON.parse(message);
          if (sid) closeSessionSockets(userId, sid);
          else closeRevokedSockets(userId, at, keepSid);
        } catch (err) {
          logger.error('Failed to handle ws:revoke event:', err);
        }
      });
    })
    .catch((err) => {
      logger.error('Failed to connect upload subscriber:', err);
    });

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Socket, head: Buffer) => {
      verifyUpgradeRequest(request, socket)
        .then((identity) => {
          if (!identity) return;

          wss.handleUpgrade(request, socket, head, (ws) => {
            const client = ws as AuthenticatedWebSocket;
            client.userId = identity.userId;
            client.isAlive = true;
            client.expiresAt = identity.expiresAt;
            client.issuedAt = identity.issuedAt;
            client.sid = identity.sid;
            client.rateLimitNoticeAt = new Map();
            wss.emit('connection', client, request);
          });
        })
        .catch((err) => {
          logger.error('WS upgrade failed:', err);
          rejectUpgrade(socket, '401');
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
      // Parsed before the limit check because the budget is per type, and
      // counted even when it fails: returning early on a parse error would let
      // a client flood malformed frames past the limiter entirely.
      let messageData: any;
      let bucket = 'invalid';
      try {
        messageData = JSON.parse(rawMessage.toString());
        if (typeof messageData?.type === 'string') bucket = messageData.type;
      } catch {
        messageData = undefined;
      }

      try {
        const verdict = await checkRateLimit(ws.userId, bucket);
        if (!verdict.allowed) {
          notifyRateLimited(ws, bucket, verdict.retryAfter);
          return;
        }

        if (!messageData) {
          logger.warn(`Malformed WebSocket frame from user ${ws.userId}`);
          return;
        }

        if (messageData.type === 'authenticate') return;

        // Never trust client-supplied identity: stamp every id the handlers
        // act on with the id proven at the upgrade handshake.
        if (messageData.message?.sender)
          messageData.message.sender._id = ws.userId;
        if (messageData.sender) messageData.sender._id = ws.userId;
        if (messageData.read_receipt)
          messageData.read_receipt.user_id = ws.userId;
        messageData.user_id = ws.userId;

        webSocketController.handleIncomingMessage(ws, messageData);
      } catch (error) {
        logger.error('Failed to handle WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      webSocketController.handleDisconnect(ws);
    });
    ws.on('error', (error) => {
      logger.error(`WebSocket error for user ${ws.userId}:`, error);
    });
  });

  /*
   * Teardown hangs off an explicit close rather than `wss.on('close')`, which
   * only fires when the WebSocketServer itself is closed — something nothing
   * did, so the heartbeat interval and the upload subscriber were never
   * released.
   */
  closeServer = async () => {
    clearInterval(heartbeatTimer);
    webSocketController.stopPresenceSweeper();

    for (const client of wss.clients) {
      client.close(CLOSE_SERVER_SHUTDOWN, 'Server shutting down');
    }

    await uploadSubscriber.unsubscribe('ws:upload').catch(() => {});
    await uploadSubscriber.unsubscribe('ws:revoke').catch(() => {});
    await uploadSubscriber.quit().catch(() => {});

    await new Promise<void>((resolve) => wss.close(() => resolve()));
  };

  logger.info('WebSocket server initialized.');
};

/** Closes the socket server and releases its timers and subscriptions. */
export const closeWebSocketServer = async (): Promise<void> => {
  await closeServer?.();
  closeServer = undefined;
};

export const getBroadcastFunction = (): BroadcastFunction => {
  if (!broadcastFunction)
    throw new Error('WebSocket service has not been initialized yet.');
  return broadcastFunction;
};

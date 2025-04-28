import { WebSocket, WebSocketServer } from 'ws';
import config from '../../config/config';
import { logger } from '../../utils/logger';

interface WebSocketMessage {
  type: string;
  userId?: string;
  sender?: string;
  to?: string[];
  message?: string;
  _id?: string;
  conversation?: string | null;
}

const clients = new Map<string, WebSocket>();

export const setupWebSocket = () => {
  const wss = new WebSocketServer({ port: Number(config.wsPort) });

  console.log('WS PORT: ' + config.wsPort);

  wss.on('connection', (ws) => {
    logger.info(`WebSocket connection established on port: ${config.wsPort}`);

    ws.on('message', (rawMessage) => {
      try {
        const data: WebSocketMessage = JSON.parse(rawMessage.toString());

        switch (data.type) {
          case 'register':
            if (!data.userId) {
              console.warn('Missing userId in register message');
              return;
            }
            if (clients.has(data.userId)) {
              console.warn(`User ${data.userId} is already registered`);
              return;
            }
            clients.set(data.userId, ws);
            break;

          case 'message':
          case 'text':
            if (!Array.isArray(data.to)) {
              console.warn('Expected "to" to be an array of user IDs');
              return;
            }
            for (const recipientId of data.to) {
              if (!clients.has(recipientId)) {
                console.warn(`User ${recipientId} is not connected`);
                continue;
              }
              sendMessageToUser(recipientId, {
                _id: data._id,
                sender: data.sender,
                content: data.message,
                type: data.type,
                conversation: data.conversation ?? null,
              });
            }
            break;

          default:
            console.warn('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      for (const [userId, socket] of clients.entries()) {
        if (socket === ws) {
          clients.delete(userId);
          logger.info(`User ${userId} disconnected`);
          break;
        }
      }
    });
  });

  return wss;
};

export const sendMessageToUser = (userId: string, payload: any) => {
  const recipientSocket = clients.get(userId);
  if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
    recipientSocket.send(JSON.stringify(payload));
  }
};

export { clients };

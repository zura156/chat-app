import { WebSocket, WebSocketServer } from 'ws';
import config from '../../config/config';
import { logger } from '../../utils/logger';

const clients = new Map<string, WebSocket>();

export const setupWebSocket = () => {
  const wss = new WebSocketServer({ port: parseInt(config.wsPort.toString()) });

  wss.on('connection', (ws) => {
    logger.info('Websocket connection on port: ' + config.wsPort);

    // On message, handle different types
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Handle user registration
        if (data.type === 'register') {
          if (!data.userId) {
            console.warn('Missing userId in register message');
            return;
          }
          clients.set(data.userId, ws);
        }

        // Handle messages (both for individual and multiple recipients)
        if (data.type === 'message' || data.type === 'text') {
          if (!Array.isArray(data.to)) {
            console.warn('Expected "to" to be an array of user IDs');
            return;
          }

          data.to.forEach((recipientId: string) => {
            const recipientSocket = clients.get(recipientId);

            if (
              recipientSocket &&
              recipientSocket.readyState === WebSocket.OPEN
            ) {
              recipientSocket.send(
                JSON.stringify({
                  _id: data._id,
                  sender: data.sender,
                  content: data.message,
                  type: data.type,
                  conversation: data.conversation ?? null,
                })
              );
            }
          });
        }
      } catch (err) {
        console.error('Error parsing message:', err);
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

export { clients };

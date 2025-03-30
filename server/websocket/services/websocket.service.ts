import { WebSocket, WebSocketServer } from 'ws';
import config from '../../config/config';
import { logger } from '../../utils/logger';

const clients = new Map<string, WebSocket>();

export const setupWebSocket = () => {
  const wss = new WebSocketServer({ port: parseInt(config.wsPort.toString()) });

  wss.on('connection', (ws) => {
    logger.info('Websocket connection on port: ' + config.wsPort);

    ws.on('message', (message) => {
      const data = JSON.parse(message.toString());

      if (data.type === 'register') {
        clients.set(data.userId, ws);
      }

      if (data.type === 'message') {
        const recipientSocket = clients.get(data.to);
        if (recipientSocket) {
          recipientSocket.send(
            JSON.stringify({ from: data.from, message: data.message })
          );
        }
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

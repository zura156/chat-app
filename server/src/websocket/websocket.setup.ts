import { Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../utils/logger';
import {
  WebSocketService,
  BroadcastFunction,
} from './services/websocket.service';
import { WebSocketController } from './controllers/websocket.controller';
import { MessageService } from '../messenger/services/message.service';

let broadcastFunction: BroadcastFunction;

export const setupWebSocket = (server: Server): void => {
  const wss = new WebSocketServer({ server });
  const webSocketService = new WebSocketService();
  const messageService = new MessageService(webSocketService.broadcast);

  const webSocketController = new WebSocketController(
    webSocketService,
    messageService
  );

  broadcastFunction = webSocketService.broadcast;

  wss.on('connection', (ws: WebSocket) => {
    logger.info('A new client has connected via WebSocket.');

    ws.on('message', (rawMessage: string) => {
      try {
        const messageData = JSON.parse(rawMessage);

        webSocketController.handleIncomingMessage(ws, messageData);
      } catch (error) {
        logger.error('Invalid WebSocket message format:', error);
      }
    });

    ws.on('close', () => {
      webSocketController.handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error occurred:', error);
    });
  });

  logger.info('WebSocket server has been initialized.');
};

/**
 * Exports the singleton broadcast function so it can be injected
 * into the Express app and used by other services.
 */
export const getBroadcastFunction = (): BroadcastFunction => {
  if (!broadcastFunction) {
    throw new Error('WebSocket service has not been initialized yet.');
  }
  return broadcastFunction;
};

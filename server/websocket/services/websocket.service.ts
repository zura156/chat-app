import { WebSocket, WebSocketServer } from 'ws';
import config from '../../config/config';
import { logger } from '../../utils/logger';
import { Message, MessageType } from '../../messenger/models/message.model';
import { Server } from 'http';

interface WebSocketRegister {
  type: 'register';
  userId: string;
}

interface ParticipantI {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  profile_picture?: string;
}

interface WebSocketMessage {
  type: 'message' | MessageType;
  sender: Partial<ParticipantI>;
  participants: Partial<ParticipantI>[];
  content: string;
  _id?: string;
  conversation: string;
}

const clients = new Map<string, WebSocket>();

export const setupWebSocket = (server: Server) => {
  const wss = new WebSocketServer({ server });

  console.log('WS PORT: ' + config.port);

  wss.on('connection', (ws) => {
    logger.info(`WebSocket connection established on port: ${config.port}`);

    ws.on('message', async (rawMessage) => {
      try {
        const data: WebSocketRegister | WebSocketMessage = JSON.parse(
          rawMessage.toString()
        );

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
            if (!Array.isArray(data.participants)) {
              console.warn(
                'Expected "participants" to be an array of user IDs'
              );
              return;
            }

            const { sender, conversation, content } = data;

            const type = 'text';

            let savedMessage;

            try {
              savedMessage = await Message.create({
                sender,
                conversation,
                content,
                type,
              });

              logger.info('💾 Message saved to DB:', savedMessage._id);
            } catch (err) {
              console.error('❌ Failed to save message:', err);
              ws.send(
                JSON.stringify({ error: 'Failed to save message to database' })
              );
              return;
            }

            for (const recipient of data.participants) {
              if (!recipient._id) continue;

              if (!clients.has(recipient._id)) {
                console.warn(`User ${recipient} is not connected`);
                continue;
              }

              sendMessageToUser(recipient._id, {
                _id: savedMessage._id,
                sender,
                content,
                type,
                conversation,
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

const sendMessageToUser = (userId: string, payload: any) => {
  const recipientSocket = clients.get(userId);
  if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
    recipientSocket.send(JSON.stringify(payload));
  }
};

export { clients };

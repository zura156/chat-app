import { clients } from '../services/websocket.service';

export const sendMessageToUser = (userId: string, message: string) => {
  const recipientSocket = clients.get(userId);
  if (recipientSocket) {
    recipientSocket.send(JSON.stringify(message));
  }
};

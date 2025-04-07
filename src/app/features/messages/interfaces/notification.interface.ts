export interface NotificationI {
  _id: string;
  recipient: string;
  sender: string;
  type: string;
  content: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

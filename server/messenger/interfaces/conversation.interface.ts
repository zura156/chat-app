export interface ConversationI {
  participants: string[];
  last_message?: string;
  is_group: boolean;
  group_name?: string;
  group_picture?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

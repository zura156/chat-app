export interface UserInterface {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  profile_picture?: string;
  status?: 'offline' | 'online' | 'away';
  last_seen?: Date;
  blocked_users?: string[];
}

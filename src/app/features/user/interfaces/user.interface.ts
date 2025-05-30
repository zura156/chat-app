export interface UserI {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  profile_picture?: string;
  status?: 'offline' | 'online';
  last_seen?: string;
  blocked_users?: string[];
}

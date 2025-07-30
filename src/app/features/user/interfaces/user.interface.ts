export interface UserI {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  bio: string;
  email: string;
  password: string;
  is_email_verified: boolean;
  login_attempts: number;
  lock_until?: string;
  last_login?: string;
  profile_picture?: string;
  status: 'offline' | 'online';
  last_seen: string;
  blocked_users: string[] | UserI[];
}

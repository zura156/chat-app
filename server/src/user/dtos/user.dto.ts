export interface UserDTO {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  bio: string;
  email: string;
  /** Set while an address change is awaiting confirmation. Self-only. */
  pending_email?: string;
  password: string;
  is_email_verified: boolean;
  login_attempts: number;
  lock_until?: string;
  last_login?: string;
  pfp_url?: string;
  pfp_variants?: {
    thumb: string;
    medium: string;
    large: string;
  };
  status: 'offline' | 'online';
  last_seen: string;
  blocked_users: string[] | UserDTO[];
}

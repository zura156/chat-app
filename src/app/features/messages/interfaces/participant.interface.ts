import { UserI } from '../../user/interfaces/user.interface';

export interface ParticipantI {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  bio: string;
  status?: 'offline' | 'online';
  pfp_url?: string;
  pfp_variants?: {
    thumb: string;
    medium: string;
    large: string;
  };
  last_seen?: string;
  blocked_users: string[] | UserI[];
}

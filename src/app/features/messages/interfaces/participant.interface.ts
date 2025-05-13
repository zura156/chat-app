export interface ParticipantI {
  _id: string;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
  status?: 'offline' | 'online';
  profile_picture?: string;
  last_seen?: string;
}

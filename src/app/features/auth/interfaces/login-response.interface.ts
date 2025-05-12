import { UserI } from '../../user/interfaces/user.interface';

export interface LoginResponseI {
  message: string;
  access_token: string;
  refresh_token: string;
  user: UserI;
}

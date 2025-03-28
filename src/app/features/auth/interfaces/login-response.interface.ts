import { UserI } from '../../../shared/interfaces/user.interface';

export interface LoginResponseI {
  message: string;
  access_token: string;
  refresh_token: string;
  user: UserI;
}

import { UserI } from '../../../shared/interfaces/user.interface';

export interface LoginResponseI {
  message: string;
  accessToken: string;
  refreshToken: string;
  user: UserI;
}

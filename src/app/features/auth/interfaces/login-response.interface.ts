import { UserI } from '../../../shared/interfaces/user.interface';

export interface LoginResponseI {
  message: string;
  token: string;
  user: UserI;
}

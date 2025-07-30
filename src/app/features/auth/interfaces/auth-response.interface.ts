import { UserI } from '../../user/interfaces/user.interface';

export interface AuthResponseI {
  message: string;
  user?: UserI;
}

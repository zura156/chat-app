import { UserI } from '../../user/interfaces/user.interface';

export interface RegisterResponseI {
  message: string;
  user: UserI;
}

import { UserI } from './user.interface';

export interface UserListI {
  users: UserI[];
  totalCount: number;
}

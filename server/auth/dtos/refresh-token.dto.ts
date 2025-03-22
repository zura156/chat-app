import { AuthRequest } from '../../middlewares/auth.middleware';
import { Request } from 'express';

export interface RefreshTokenDto extends AuthRequest {
  headers: Request['headers'] & {
    authorization?: string; // Access token
    'refresh-token'?: string; // Refresh token
  };
}

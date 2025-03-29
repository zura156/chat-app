import { Request } from 'express';

export interface RefreshTokenDto extends Request {
  headers: Request['headers'] & {
    authorization?: string; // Access token
    'refresh-token'?: string; // Refresh token
  };
}

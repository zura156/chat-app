import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { NewPasswordDto } from '../dtos/set-new-password.dto';
import { AuthService } from '../services/auth.service';
import { Request } from 'express';

export class AuthController {
  static async register(req: Request): Promise<void> {
    const credentials: RegisterDto = req.body;

    AuthService.register(credentials);
  }

  static async login(req: Request): Promise<void> {
    const credentials: LoginDto = req.body;

    AuthService.login(credentials);
  }

  // @AuthGuard()
  static async logout(req: Request): Promise<void> {
    const token: string = req.headers['authorization']!;
    AuthService.logout(token);
  }

  // @AuthGuard()
  static async resetPassword(req: Request): Promise<void> {
    const credentials: ResetPasswordDto = req.body;
    AuthService.resetPassword(credentials);
  }

  // @AuthGuard()
  static async setNewPassword(req: Request): Promise<void> {
    const credentials: NewPasswordDto = req.body;
    AuthService.setNewPassword(credentials);
  }
}

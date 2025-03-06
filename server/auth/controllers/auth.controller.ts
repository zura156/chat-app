import { Request, Response, NextFunction } from 'express';
import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { NewPasswordDto } from '../dtos/set-new-password.dto';
import { AuthService } from '../services/auth.service';

export class AuthController {
  static async register(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const credentials: RegisterDto = req.body;
      const result = await AuthService.register(credentials);
      res
        .status(201)
        .json({ message: 'User registered successfully', data: result });
    } catch (error) {
      next(error);
    }
  }

  static async login(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const credentials: LoginDto = req.body;
      const result = await AuthService.login(credentials);
      res.status(200).json({ message: 'Login successful', data: result });
    } catch (error) {
      next(error);
    }
  }

  // @AuthGuard()
  static async logout(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const token = req.headers['authorization'];
      if (!token) {
        res.status(401).json({ message: 'Unauthorized: No token provided' });
        next({ message: 'Unauthorized: No token provided', statusCode: 401 });
      }
      await AuthService.logout(token || '');
      res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
      next(error);
    }
  }

  // @AuthGuard()
  static async resetPassword(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const credentials: ResetPasswordDto = req.body;
      await AuthService.resetPassword(credentials);
    } catch (error) {
      next(error);
    }
  }

  // @AuthGuard()
  static async setNewPassword(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const credentials: NewPasswordDto = req.body;
      await AuthService.setNewPassword(credentials);
    } catch (error) {
      next(error);
    }
  }
}

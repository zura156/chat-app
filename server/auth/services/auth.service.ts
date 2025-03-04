import { LoginDto } from '../dtos/login.dto';
import { RegisterDto } from '../dtos/register.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { NewPasswordDto } from '../dtos/set-new-password.dto';

export class AuthService {
  public static async register(credentials: RegisterDto) {
    console.log('Registering a new user');
  }

  public static async login(credentials: LoginDto) {
    console.log('Logging in a user');
  }

  public static async logout(token: string) {
    console.log('Logging out a user');
  }

  public static async resetPassword(credentials: ResetPasswordDto) {
    console.log('Reset password');
  }

  public static async setNewPassword(credentials: NewPasswordDto) {
    console.log('Set new password');
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

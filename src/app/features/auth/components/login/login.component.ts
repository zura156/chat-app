import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { LoginCredentialsI } from '../../interfaces/login-credentials.interface';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';

import { catchError, Subject, takeUntil, tap, throwError } from 'rxjs';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../../../shared/services/theme.service';

@Component({
  selector: 'app-login',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HlmFieldImports,
    HlmInput,
    HlmButton,
    HlmIcon,
    NgIcon,
    HlmAlertImports,
  ],
  providers: [
    provideIcons({ lucideCircleAlert, lucideTriangleAlert, lucideLoader }),
  ],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  showPass = signal<boolean>(false);
  error = signal<string>('');
  isLoading = signal<boolean>(false);

  /** Set once the password is accepted on an account with a second factor. */
  twoFactorRequired = this.authService.twoFactorRequired;
  twoFactorCode = signal<string>('');

  /*
   * `required` and nothing more on the password.
   *
   * It carried `passwordValidator()`, which is a rule about what a password may
   * be *set* to — and `onSubmit` refuses to submit an invalid form. So an
   * account whose password predates the current rules could not sign in at all:
   * the form answered "Please fill in all fields correctly" for a password that
   * was entirely correct, with no way to proceed and nothing to explain it.
   * (Reachable today: a password set through the old reset flow only had to
   * satisfy the Mongoose validator, which accepts symbols this form did not.)
   *
   * A sign-in field proves you know a secret; it does not get to have opinions
   * about the secret. The server takes the same view — see the note on
   * `validateChangePassword` in auth.router.
   */
  form: FormGroup = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required]),
  });

  private destroy$ = new Subject<void>();

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }

  clearError(): void {
    this.error.set('');
  }

  onSubmit(): void {
    this.isLoading.set(true);

    if (this.form.invalid) {
      this.isLoading.set(false);
      this.error.set('Please fill in all fields correctly.');
      return;
    }

    const credentials: LoginCredentialsI = {
      email: this.form.value.email,
      password: this.form.value.password,
    };

    this.authService
      .login(credentials)
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.clearError();
          this.isLoading.set(false);
          // A pending second factor emits null and keeps the user here.
          if (!this.twoFactorRequired()) this.router.navigateByUrl('/messages');
        }),
        catchError((errorMessage) => {
          this.error.set(errorMessage);
          this.isLoading.set(false);
          return throwError(() => errorMessage);
        }),
      )
      .subscribe();
  }

  onTwoFactorCodeInput(value: string): void {
    // Authenticator codes are six digits; recovery codes are XXXXX-XXXXX.
    this.twoFactorCode.set(value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11));
  }

  submitTwoFactorCode(): void {
    const code = this.twoFactorCode().trim();
    if (!code) return;

    this.isLoading.set(true);

    this.authService
      .submitTwoFactorCode(code)
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.clearError();
          this.isLoading.set(false);
          this.router.navigateByUrl('/messages');
        }),
        catchError((errorMessage) => {
          this.error.set(errorMessage);
          this.isLoading.set(false);
          this.twoFactorCode.set('');
          return throwError(() => errorMessage);
        }),
      )
      .subscribe();
  }

  cancelTwoFactor(): void {
    this.authService.cancelTwoFactor();
    this.twoFactorCode.set('');
    this.clearError();
  }
}

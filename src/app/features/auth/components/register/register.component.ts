import { Component, inject, OnDestroy, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { trimControls } from '../../../../shared/functions/form.utils';
import { repeatPasswordValidator } from '../../validators/repeat-password.validator';
import { AuthService } from '../../services/auth.service';
import { RegisterCredentialsI } from '../../interfaces/register-credentials.interface';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { catchError, Subject, takeUntil, tap, throwError } from 'rxjs';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordValidator,
} from '../../validators/password.validator';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../../../shared/services/theme.service';

@Component({
  selector: 'app-register',
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
  templateUrl: './register.component.html',
})
export class RegisterComponent implements OnDestroy {
  private authService = inject(AuthService);
  private router = inject(Router);
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  showPass = signal<boolean>(false);
  showRepeatPass = signal<boolean>(false);
  error = signal<string>('');
  isLoading = signal<boolean>(false);

  form: FormGroup = new FormGroup(
    {
      first_name: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      last_name: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      username: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      email: new FormControl('', [Validators.required, Validators.email]),
      // The context is read lazily so the rule against building a password out
      // of your own username sees what is in those fields *now*, not what they
      // held when the form was constructed.
      password: new FormControl('', [
        Validators.required,
        passwordValidator(() => ({
          username: this.form?.get('username')?.value,
          email: this.form?.get('email')?.value,
        })),
      ]),
      repeat_password: new FormControl('', [Validators.required]),
    },
    {
      validators: repeatPasswordValidator('password', 'repeat_password'),
    },
  );

  /** Surfaced so the checklist quotes the policy rather than restating it. */
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  readonly passwordMaxLength = PASSWORD_MAX_LENGTH;

  private destroy$ = new Subject<void>();

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }

  toggleRepeatPasswordVisibility(): void {
    this.showRepeatPass.update((val) => !val);
  }

  clearError(): void {
    this.error.set('');
  }

  onSubmit(): void {
    this.isLoading.set(true);

    /*
     * Before the validity check. The names carry `minLength(3)`, which counts
     * spaces — so "  ab  " passed a rule "ab" does not, and the server, which
     * trims before applying its own, stored a name this form would have
     * refused. The address has the same problem in reverse: `Validators.email`
     * rejects one with spaces around it outright.
     *
     * The two password fields are deliberately absent: trimming a password
     * changes it, and the account would be created with a secret its owner
     * never typed.
     */
    trimControls(this.form, ['first_name', 'last_name', 'username', 'email']);

    if (this.form.invalid) {
      this.isLoading.set(false);
      this.error.set('Please fill in all fields correctly.');
      return;
    }
    const credentials: RegisterCredentialsI = {
      first_name: this.form.value.first_name,
      last_name: this.form.value.last_name,
      username: this.form.value.username,
      email: this.form.value.email,
      password: this.form.value.password,
    };

    this.authService
      .register(credentials)
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.clearError();
          this.isLoading.set(false);
          this.router.navigateByUrl('/auth/login');
        }),
        catchError((errorMessage) => {
          this.error.set(errorMessage);
          this.isLoading.set(false);
          return throwError(() => errorMessage);
        }),
      )
      .subscribe();
  }
}

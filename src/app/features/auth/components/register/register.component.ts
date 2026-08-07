import { Component, inject, OnDestroy, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  applyServerFieldErrors,
  clearServerFieldErrors,
  markFormGroupTouched,
  summarizeFormErrors,
  trimControls,
} from '../../../../shared/functions/form.utils';
import { apiErrorMessage } from '../../../../shared/functions/api-error';
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

/** The server's `USERNAME_PATTERN`, restated so the form can refuse first. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** How the fields are named in a sentence, rather than as control keys. */
const FIELD_LABELS: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  username: 'Username',
  email: 'Email',
  password: 'Password',
  repeat_password: 'Confirm password',
};

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

  /*
   * These mirror `validateRegistration` in the API's auth.router, field for
   * field. They did not, and every disagreement was a dead end for the user:
   *
   *   - the names required 3 characters where the server requires 1 and allows
   *     64, so "Li" was refused by a form that would not say which of its six
   *     inputs it meant, and a 40-character surname was accepted here and
   *     rejected there;
   *   - the username had no character rule at all, while the server insists on
   *     letters, numbers, dots, underscores and hyphens. Typing a space — the
   *     obvious thing to do in a field a person reads as a name — produced a
   *     round trip that came back "Validation failed" and nothing else.
   */
  form: FormGroup = new FormGroup(
    {
      first_name: new FormControl('', [
        Validators.required,
        Validators.maxLength(64),
      ]),
      last_name: new FormControl('', [
        Validators.required,
        Validators.maxLength(64),
      ]),
      username: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
        Validators.pattern(USERNAME_PATTERN),
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

    // A previous submit's server errors describe values that have since been
    // edited; leaving them would keep the form unsubmittable with no way to
    // clear them.
    clearServerFieldErrors(this.form);

    if (this.form.invalid) {
      this.isLoading.set(false);
      // `markFormGroupTouched` first: the per-field messages under each input
      // are the detailed half of this, and an untouched control does not show
      // them — so a user who pressed the button without typing got the banner
      // and no indication of where to look.
      markFormGroupTouched(this.form);
      this.error.set(summarizeFormErrors(this.form, FIELD_LABELS));
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
        catchError((err) => {
          this.isLoading.set(false);

          /*
           * The server checks things this form cannot: whether the address is
           * already registered, whether the password appears in a breach
           * corpus. Those refusals name their field, so they belong under the
           * input rather than in a banner the user has to map back onto six
           * of them.
           */
          const placed = applyServerFieldErrors(this.form, err);
          this.error.set(
            apiErrorMessage(err, 'Could not create your account.'),
          );

          // Scroll the first refused field into view — on a phone the banner
          // and the input it refers to are rarely on screen together.
          if (placed.length > 0) {
            document.getElementById(placed[0])?.focus({ preventScroll: false });
          }

          return throwError(() => err);
        }),
      )
      // Without an error callback the rethrow above is an unhandled rejection,
      // which RxJS reports globally alongside the message the user is meant to
      // read.
      .subscribe({ error: () => undefined });
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  markFormGroupTouched,
  summarizeFormErrors,
  trimControls,
} from '../../../../shared/functions/form.utils';
import { apiErrorMessage } from '../../../../shared/functions/api-error';
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
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../../../shared/services/theme.service';

/** How the fields are named in a sentence, rather than as control keys. */
const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Password',
};

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
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  showPass = signal<boolean>(false);
  error = signal<string>('');
  isLoading = signal<boolean>(false);

  /** Set once the password is accepted on an account with a second factor. */
  twoFactorRequired = this.authService.twoFactorRequired;
  twoFactorMethods = this.authService.twoFactorMethods;
  twoFactorMethod = this.authService.twoFactorMethod;
  twoFactorCode = signal<string>('');

  /** Only worth offering a choice when there is one. */
  canChooseMethod = computed(() => this.twoFactorMethods().length > 1);

  /**
   * True once a code has been sent in this challenge, so the button can stop
   * saying "Send" and the hint can stop implying nothing has happened.
   */
  emailCodeSent = signal<boolean>(false);

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

    // Before the validity check, not after: `Validators.email` rejects an
    // address with spaces around it, so a pasted one failed the form and never
    // reached the server at all. Never the password — trimming one changes the
    // secret, and the server trims nothing when it hashes.
    trimControls(this.form, ['email']);

    if (this.form.invalid) {
      this.isLoading.set(false);
      // Names the field and the rule. "Please fill in all fields correctly."
      // was the whole of what this said, across two inputs and three
      // validators, and it is the message a user sees after mistyping their
      // own address — the one case where knowing *which* field is at fault
      // matters most, because the other one holds a secret they cannot read
      // back.
      markFormGroupTouched(this.form);
      this.error.set(summarizeFormErrors(this.form, FIELD_LABELS));
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

          /*
           * A pending second factor emits null and keeps the user here. When
           * the only factor is email the server has already sent the code as
           * part of answering the password step, so the screen must not offer
           * to send a first one.
           */
          this.emailCodeSent.set(
            this.twoFactorRequired() &&
              this.twoFactorMethods().length === 1 &&
              this.twoFactorMethod() === 'email',
          );

          /*
           * Navigation on success belongs to AuthService.completeLogin, which
           * honours the `returnUrl` the guard recorded. Sending everyone to
           * /messages from here as well overrode it, so a deep link that
           * bounced through the login screen was silently discarded — the exact
           * bug the returnUrl handling exists to prevent.
           */
        }),
        catchError((err) => {
          this.error.set(apiErrorMessage(err, 'Could not sign you in.'));
          this.isLoading.set(false);
          return throwError(() => err);
        }),
      )
      // `catchError` has already put the message on screen; the rethrow keeps
      // the stream from emitting a success it did not have. Without an error
      // callback here RxJS treats that as unhandled and reports it globally, so
      // every wrong code raised an uncaught error alongside the message the
      // user was meant to read.
      .subscribe({ error: () => undefined });
  }

  onTwoFactorCodeInput(value: string): void {
    // Authenticator and email codes are six digits; recovery codes are
    // XXXXX-XXXXX, and are accepted whichever factor is selected.
    this.twoFactorCode.set(value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11));
  }

  /** Switches which factor is being answered, without restarting the sign-in. */
  chooseMethod(method: 'totp' | 'email'): void {
    if (this.twoFactorMethod() === method) return;

    this.authService.chooseTwoFactorMethod(method);
    this.twoFactorCode.set('');
    this.clearError();
  }

  sendEmailCode(): void {
    this.isLoading.set(true);

    this.authService
      .requestTwoFactorEmailCode()
      .pipe(
        takeUntil(this.destroy$),
        tap(() => {
          this.emailCodeSent.set(true);
          this.isLoading.set(false);
          this.clearError();
        }),
        catchError((err) => {
          this.error.set(
            apiErrorMessage(err, 'Could not send a code to your address.'),
          );
          this.isLoading.set(false);
          return throwError(() => err);
        }),
      )
      // `catchError` has already put the message on screen; the rethrow keeps
      // the stream from emitting a success it did not have. Without an error
      // callback here RxJS treats that as unhandled and reports it globally, so
      // every wrong code raised an uncaught error alongside the message the
      // user was meant to read.
      .subscribe({ error: () => undefined });
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
          // completeLogin owns the navigation, and honours returnUrl.
        }),
        catchError((err) => {
          this.error.set(apiErrorMessage(err, 'That code was not accepted.'));
          this.isLoading.set(false);
          this.twoFactorCode.set('');
          return throwError(() => err);
        }),
      )
      // `catchError` has already put the message on screen; the rethrow keeps
      // the stream from emitting a success it did not have. Without an error
      // callback here RxJS treats that as unhandled and reports it globally, so
      // every wrong code raised an uncaught error alongside the message the
      // user was meant to read.
      .subscribe({ error: () => undefined });
  }

  cancelTwoFactor(): void {
    this.authService.cancelTwoFactor();
    this.twoFactorCode.set('');
    this.emailCodeSent.set(false);
    this.clearError();
  }
}

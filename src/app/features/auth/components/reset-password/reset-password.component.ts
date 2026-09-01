import { Component, DestroyRef, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordValidator,
} from '../../validators/password.validator';
import {
  applyServerFieldErrors,
  clearServerFieldErrors,
  markFormGroupTouched,
  summarizeFormErrors,
} from '../../../../shared/functions/form.utils';
import { repeatPasswordValidator } from '../../validators/repeat-password.validator';
import { apiErrorMessage } from '../../../../shared/functions/api-error';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../services/auth.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, switchMap, take, tap, throwError, timer } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { ResetPasswordI } from '../../interfaces/reset-password.interface';
import { ThemeService } from '../../../../shared/services/theme.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
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
})
export class ResetPasswordComponent {
  private readonly destroyRef = inject(DestroyRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  /*
   * No identity context on `passwordValidator()`, and there cannot be one: the
   * reset link carries a token and a user id, so this form has no way to know
   * the username or address the rule is about. The server does apply it — see
   * `passwordRefusal` in resetPassword — and now returns that refusal against
   * the `password` field, so `applyServerFieldErrors` can put it under the
   * input instead of leaving the checklist looking satisfied.
   */
  form: FormGroup = new FormGroup(
    {
      password: new FormControl('', [Validators.required, passwordValidator()]),
      repeat_password: new FormControl('', [Validators.required]),
    },
    { validators: repeatPasswordValidator('password', 'repeat_password') },
  );

  /** Surfaced so the checklist quotes the policy rather than restating it. */
  readonly passwordMinLength = PASSWORD_MIN_LENGTH;
  readonly passwordMaxLength = PASSWORD_MAX_LENGTH;

  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  showPass = signal<boolean>(false);
  showRepeatPass = signal<boolean>(false);
  resetToken = signal<string>('');

  onSubmit(): void {
    // A previous submit's server errors describe a password that has since been
    // retyped; leaving them would keep the form unsubmittable with nothing the
    // user can do about it.
    clearServerFieldErrors(this.form);

    if (!this.form.valid) {
      /*
       * The old message ("Please enter credentials acording to validations")
       * was doubly unhelpful here: this form has one field, and the reason it
       * is invalid is almost always the password policy — whose five clauses
       * are already rendered as a live checklist a few lines up the template.
       * The banner now points at that instead of restating nothing.
       */
      markFormGroupTouched(this.form);
      this.error.set(
        summarizeFormErrors(
          this.form,
          { password: 'Password' },
          'Please choose a password that meets the requirements above.',
        ),
      );
      return;
    }

    const new_password = this.form.get('password')?.value;

    if (!new_password) return;

    this.isLoading.set(true);

    this.route.queryParams
      .pipe(
        // the params stream is long-lived: without take(1) a later param change
        // re-submits the reset, and the subscription outlives the component
        take(1),
        takeUntilDestroyed(this.destroyRef),
        switchMap(({ token, id }) => {
          const body: ResetPasswordI = {
            token,
            new_password,
            userId: id,
          };
          return this.authService.resetPassword(body).pipe(
            catchError((err) => {
              this.isLoading.set(false);
              /*
               * The reasons the server has here are ones no client check can
               * reproduce: the link has expired, it has already been used, the
               * password appears in a breach corpus, or it is built out of the
               * username — which this form cannot check, because the link
               * carries only a token and an id.
               *
               * Placed under the input where the server names a field, so the
               * refusal appears against the thing it is about rather than only
               * in the banner above a checklist showing five green ticks.
               */
              applyServerFieldErrors(this.form, err);
              this.error.set(
                apiErrorMessage(err, 'Could not reset your password.'),
              );

              return throwError(() => err);
            }),
            tap((res) => {
              this.error.set(null);
              this.isLoading.set(false);
              toast.success('Password updated.', {
                description: res.message,
              });
            }),
            switchMap(() =>
              timer(5000).pipe(
                tap(() => this.router.navigateByUrl('/auth/login')),
              ),
            ),
          );
        }),
      )
      .subscribe({ error: () => undefined });
  }

  clearError() {
    this.error.set(null);
  }

  toggleRepeatPasswordVisibility(): void {
    this.showRepeatPass.update((val) => !val);
  }

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }
}

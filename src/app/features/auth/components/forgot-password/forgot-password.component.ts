import { Component, inject, signal } from '@angular/core';
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
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmInput } from '@spartan-ng/helm/input';
import { RouterLink } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../services/auth.service';
import { catchError, throwError } from 'rxjs';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { ThemeService } from '../../../../shared/services/theme.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
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
export class ForgotPasswordComponent {
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  form: FormGroup = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  onSubmit(): void {
    // Before the validity check: `Validators.email` refuses an address with
    // spaces around it, and a pasted one is the common way to arrive here.
    trimControls(this.form, ['email']);

    if (!this.form.valid) {
      // Was "Please enter credentials acording to validations and proceed to
      // submission." — a sentence that misspells "according", says nothing
      // about which validation, and is shown on a form with exactly one field
      // whose only possible faults are "empty" and "not an address".
      markFormGroupTouched(this.form);
      this.error.set(summarizeFormErrors(this.form, { email: 'Email' }));
      return;
    }

    const email = this.form.get('email')?.value;

    if (!email) return;

    this.isLoading.set(true);

    this.authService
      .forgotPassword(email)
      .pipe(
        /*
         * The parameter used to be annotated `string` and put straight into a
         * signal the template renders — an assertion, not a check, and a false
         * one: `forgotPassword` was the single request in AuthService without
         * an error handler, so what arrived was the raw HttpErrorResponse and
         * the screen rendered `[object Object]` as the explanation.
         */
        catchError((err) => {
          this.isLoading.set(false);
          this.error.set(
            apiErrorMessage(err, 'Could not send a reset link. Try again.'),
          );

          return throwError(() => err);
        }),
      )
      .subscribe({
        next: (res) => {
          this.error.set(null);
          this.isLoading.set(false);
          toast.info('Please check your email inbox.', {
            description: res.message,
          });
        },
        // The message is already on screen; this stops the rethrow above from
        // being reported as an unhandled error on top of it.
        error: () => undefined,
      });
  }

  clearError() {
    this.error.set(null);
  }
}

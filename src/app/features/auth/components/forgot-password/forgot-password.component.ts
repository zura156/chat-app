import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
    if (!this.form.valid) {
      toast.info('Form Invalid!', {
        description:
          'Please enter credentials acording to validations and proceed to submission.',
      });
      return;
    }

    const email = this.form.get('email')?.value;

    if (!email) return;

    this.isLoading.set(true);

    this.authService
      .forgotPassword(email)
      .pipe(
        catchError((error: string) => {
          this.isLoading.set(false);
          this.error.set(error);

          return throwError(() => error);
        }),
      )
      .subscribe((res) => {
        this.error.set(null);
        this.isLoading.set(false);
        toast.info('Please check your email inbox.', {
          description: res.message,
        });
      });
  }

  clearError() {
    this.error.set(null);
  }
}

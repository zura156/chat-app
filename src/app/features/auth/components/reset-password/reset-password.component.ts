import { Component, inject, signal } from '@angular/core';
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
import { passwordValidator } from '../../validators/password.validator';
import { toast } from '@spartan-ng/brain/sonner';
import { AuthService } from '../../services/auth.service';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, switchMap, tap, throwError, timer } from 'rxjs';
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
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);

  isDarkMode = this.themeService.isDarkMode;

  form: FormGroup = new FormGroup({
    password: new FormControl('', [Validators.required, passwordValidator()]),
  });

  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  showPass = signal<boolean>(false);
  resetToken = signal<string>('');

  onSubmit(): void {
    if (!this.form.valid) {
      toast.info('Form Invalid!', {
        description:
          'Please enter credentials acording to validations and proceed to submission.',
      });
      return;
    }

    const new_password = this.form.get('password')?.value;

    if (!new_password) return;

    this.route.queryParams
      .pipe(
        switchMap(({ token, id }) => {
          const body: ResetPasswordI = {
            token,
            new_password,
            userId: id,
          };
          return this.authService.resetPassword(body).pipe(
            catchError((error: string) => {
              this.isLoading.set(false);
              this.error.set(error);

              return throwError(() => error);
            }),
            tap((res) => {
              this.error.set(null);
              this.isLoading.set(false);
              toast.info('Please check your email inbox.', {
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
      .subscribe();
  }

  clearError() {
    this.error.set(null);
  }

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }
}

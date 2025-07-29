import { Component, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { NavController } from '@ionic/angular/standalone';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmFormFieldModule } from '@spartan-ng/helm/form-field';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { passwordValidator } from '../../validators/password.validator';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../services/auth.service';
import { ActivatedRoute } from '@angular/router';
import { catchError, switchMap, tap, throwError, timer } from 'rxjs';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { ResetPasswordI } from '../../interfaces/reset-password.interface';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  imports: [
    ReactiveFormsModule,
    HlmFormFieldModule,
    HlmInputDirective,
    HlmButtonDirective,
    HlmIconDirective,
    NgIcon,
    HlmAlertImports,
  ],
  providers: [
    provideIcons({ lucideCircleAlert, lucideTriangleAlert, lucideLoader }),
  ],
})
export class ResetPasswordComponent {
  private navCtrl = inject(NavController);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);

  form: FormGroup = new FormGroup({
    password: new FormControl('', [Validators.required, passwordValidator()]),
  });

  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  showPass = signal<boolean>(false);
  userId = signal<string>('');
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
        switchMap(({ token }) => {
          const body: ResetPasswordI = {
            token,
            new_password,
          };
          return this.authService.resetPassword(body).pipe(
            catchError((error: HttpErrorResponse) => {
              this.isLoading.set(false);
              this.error.set(error.message);

              toast.error('Error occured!', {
                description: error.message,
              });

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
                tap(() => this.navCtrl.navigateRoot('/auth/login'))
              )
            )
          );
        })
      )
      .subscribe();
  }

  clearError() {
    this.error.set(null);
  }

  navigate(url: string): void {
    this.navCtrl.navigateRoot(url);
  }

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }
}

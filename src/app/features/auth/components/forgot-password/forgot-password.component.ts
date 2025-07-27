import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmFormFieldModule } from '@spartan-ng/helm/form-field';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { NavController } from '@ionic/angular/standalone';
import { toast } from 'ngx-sonner';
import { AuthService } from '../../services/auth.service';
import { catchError, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
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
export class ForgotPasswordComponent {
  private navCtrl = inject(NavController);
  private authService = inject(AuthService);

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
        catchError((error: HttpErrorResponse) => {
          this.isLoading.set(false);
          this.error.set(error.message);

          toast.error('Error occured!', {
            description: error.message,
          });

          return throwError(() => error);
        })
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
  navigate(url: string): void {
    this.navCtrl.navigateRoot(url);
  }
}

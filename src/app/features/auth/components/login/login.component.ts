import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { LoginCredentialsI } from '../../interfaces/login-credentials.interface';

import { HlmFormFieldModule } from '@spartan-ng/helm/form-field';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';

import { passwordValidator } from '../../validators/password.validator';
import { catchError, Subject, takeUntil, tap, throwError } from 'rxjs';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { NavController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-login',
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
  templateUrl: './login.component.html',
})
export class LoginComponent {
  authService = inject(AuthService);
  navCtrl = inject(NavController);

  showPass = signal<boolean>(false);
  error = signal<string>('');
  isLoading = signal<boolean>(false);

  form: FormGroup = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, passwordValidator()]),
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
          this.navCtrl.navigateRoot('/messages', {
            animationDirection: 'forward',
          });
        }),
        catchError((err) => {
          this.error.set(err.message);
          this.isLoading.set(false);
          return throwError(() => err);
        })
      )
      .subscribe();
  }

  navigate(url: string): void {
    this.navCtrl.navigateRoot(url);
  }
}

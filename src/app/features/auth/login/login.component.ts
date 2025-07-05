import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';

import { HlmFormFieldModule } from '@spartan-ng/helm/form-field';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { HlmLabelDirective } from '@spartan-ng/helm/label';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';

import { passwordValidator } from '../validators/password.validator';
import { catchError, Subject, takeUntil, tap, throwError } from 'rxjs';
import {
  HlmAlertDescriptionDirective,
  HlmAlertDirective,
  HlmAlertIconDirective,
} from '@spartan-ng/helm/alert';

@Component({
  selector: 'app-login',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HlmFormFieldModule,
    HlmInputDirective,
    HlmLabelDirective,
    HlmButtonDirective,
    HlmIconDirective,
    NgIcon,
    HlmAlertDescriptionDirective,
    HlmAlertDirective,
    HlmAlertIconDirective,
  ],
  providers: [
    provideIcons({ lucideCircleAlert, lucideTriangleAlert, lucideLoader }),
  ],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  authService = inject(AuthService);
  router = inject(Router);

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
          this.router.navigateByUrl('/messages');
        }),
        catchError((err) => {
          this.error.set(err.message);
          this.isLoading.set(false);
          return throwError(() => err);
        })
      )
      .subscribe();
  }
}

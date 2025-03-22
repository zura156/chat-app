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

import { HlmFormFieldModule } from '@spartan-ng/ui-formfield-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { NgIf } from '@angular/common';
import { passwordValidator } from '../validators/password.validator';
import { catchError, tap, throwError } from 'rxjs';
import {
  HlmAlertDescriptionDirective,
  HlmAlertDirective,
  HlmAlertIconDirective,
} from '@spartan-ng/ui-alert-helm';

@Component({
  selector: 'app-login',
  imports: [
    NgIf,
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

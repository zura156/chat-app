import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { repeatPasswordValidator } from '../validators/repeat-password.validator';
import { AuthService } from '../services/auth.service';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmFormFieldModule } from '@spartan-ng/ui-formfield-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';

import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { catchError, tap, throwError } from 'rxjs';
import {
  HlmAlertDescriptionDirective,
  HlmAlertDirective,
  HlmAlertIconDirective,
} from '@spartan-ng/ui-alert-helm';
import { passwordValidator } from '../validators/password.validator';

@Component({
  selector: 'app-register',
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
    HlmAlertIconDirective
],
  providers: [
    provideIcons({ lucideCircleAlert, lucideTriangleAlert, lucideLoader }),
  ],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  authService = inject(AuthService);
  router = inject(Router);

  showPass = signal<boolean>(false);
  showRepeatPass = signal<boolean>(false);
  error = signal<string>('');
  isLoading = signal<boolean>(false);

  form: FormGroup = new FormGroup(
    {
      first_name: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      last_name: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      username: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, passwordValidator()]),
      repeat_password: new FormControl('', [Validators.required]),
    },
    {
      validators: repeatPasswordValidator('password', 'repeat_password'),
    }
  );

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }

  toggleRepeatPasswordVisibility(): void {
    this.showRepeatPass.update((val) => !val);
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
    const credentials: RegisterCredentialsI = {
      first_name: this.form.value.first_name,
      last_name: this.form.value.last_name,
      username: this.form.value.username,
      email: this.form.value.email,
      password: this.form.value.password,
    };

    this.authService
      .register(credentials)
      .pipe(
        tap(() => {
          this.clearError();
          this.isLoading.set(false);
          this.router.navigateByUrl('/login');
        }),
        catchError((err) => {
          this.error.set(err.error.message);
          this.isLoading.set(false);
          return throwError(() => err);
        })
      )
      .subscribe();
  }
}

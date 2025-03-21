import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { matchPassword } from '../validators/password-match.validator';
import { AuthService } from '../services/auth.service';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmFormFieldModule } from '@spartan-ng/ui-formfield-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { NgIf } from '@angular/common';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideTriangleAlert } from '@ng-icons/lucide';
import { catchError, tap, throwError } from 'rxjs';
import {
  HlmAlertDescriptionDirective,
  HlmAlertDirective,
  HlmAlertIconDirective,
} from '@spartan-ng/ui-alert-helm';

@Component({
  selector: 'app-register',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HlmFormFieldModule,
    HlmInputDirective,
    HlmLabelDirective,
    HlmButtonDirective,
    NgIf,
    HlmIconDirective,
    NgIcon,
    HlmAlertDirective,
    HlmAlertDescriptionDirective,
    HlmAlertIconDirective,
  ],
  providers: [provideIcons({ lucideCircleAlert, lucideTriangleAlert })],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  authService = inject(AuthService);
  router = inject(Router);

  showPass = signal<boolean>(false);
  showRepeatPass = signal<boolean>(false);

  error = signal<string>('');

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
      password: new FormControl('', [Validators.required]),
      repeat_password: new FormControl('', [Validators.required]),
    },
    {
      validators: matchPassword,
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
    if (this.form.invalid) {
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
          this.router.navigate(['/login']);
        }),
        catchError((err) => {
          this.error.set(err.error.message);
          return throwError(() => err);
        })
      )
      .subscribe();
  }
}

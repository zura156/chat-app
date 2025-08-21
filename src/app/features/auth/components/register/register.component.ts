import { Component, inject, OnDestroy, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { repeatPasswordValidator } from '../../validators/repeat-password.validator';
import { AuthService } from '../../services/auth.service';
import { RegisterCredentialsI } from '../../interfaces/register-credentials.interface';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmFormFieldModule } from '@spartan-ng/helm/form-field';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleAlert,
  lucideLoader,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { catchError, Subject, takeUntil, tap, throwError } from 'rxjs';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { passwordValidator } from '../../validators/password.validator';
import { NavController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    HlmFormFieldModule,
    HlmInput,
    HlmButton,
    HlmIcon,
    NgIcon,
    HlmAlertImports,
  ],
  providers: [
    provideIcons({ lucideCircleAlert, lucideTriangleAlert, lucideLoader }),
  ],
  templateUrl: './register.component.html',
})
export class RegisterComponent implements OnDestroy {
  authService = inject(AuthService);
  navCtrl = inject(NavController);

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

  private destroy$ = new Subject<void>();

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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
        takeUntil(this.destroy$),
        tap(() => {
          this.clearError();
          this.isLoading.set(false);
          this.navCtrl.navigateRoot('/auth/login');
        }),
        catchError((err) => {
          this.error.set(err.error.message);
          this.isLoading.set(false);
          return throwError(() => err);
        })
      )
      .subscribe();
  }
  navigate(url: string) {
    this.navCtrl.navigateRoot(url);
  }
}

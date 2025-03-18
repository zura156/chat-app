import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { repeatPasswordValidator } from '../validators/repeat-password.validator';
import { AuthService } from '../services/auth.service';
import { RegisterCredentialsI } from '../interfaces/register-credentials.interface';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmFormFieldModule } from '@spartan-ng/ui-formfield-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';

@Component({
  selector: 'app-register',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HlmFormFieldModule,
    HlmInputDirective,
    HlmLabelDirective,
    HlmButtonDirective,
  ],
  templateUrl: './register.component.html',
})
export class RegisterComponent {
  authService = inject(AuthService);

  showPass = signal<boolean>(false);
  showRepeatPass = signal<boolean>(false);


  form: FormGroup = new FormGroup(
    {
      firstName: new FormControl('', [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(32),
      ]),
      lastName: new FormControl('', [
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
      repeatPassword: new FormControl('', [Validators.required]),
    },
    {
      validators: repeatPasswordValidator,
    }
  );

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }

  toggleRepeatPasswordVisibility(): void {
    this.showRepeatPass.update((val) => !val);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }
    const credentials: RegisterCredentialsI = {
      first_name: this.form.value.firstName,
      last_name: this.form.value.lastName,
      username: this.form.value.username,
      email: this.form.value.email,
      password: this.form.value.password,
    };
    this.authService.register(credentials).subscribe();
    console.log(credentials);
  }
}

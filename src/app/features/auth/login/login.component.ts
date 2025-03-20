import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';

import { HlmFormFieldModule } from '@spartan-ng/ui-formfield-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert } from '@ng-icons/lucide';

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
  ],
  providers: [provideIcons({ lucideCircleAlert })],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  authService = inject(AuthService);

  showPass = signal<boolean>(false);

  form: FormGroup = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required]),
  });

  onSubmit(): void {
    const credentials: LoginCredentialsI = {
      email: this.form.value.email,
      password: this.form.value.password,
    };
    this.authService.login(credentials).subscribe((res) => console.log(res));
  }

  togglePasswordVisibility(): void {
    this.showPass.update((val) => !val);
  }
}

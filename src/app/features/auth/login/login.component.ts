import { Component, inject } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { LoginCredentialsI } from '../interfaces/login-credentials.interface';

@Component({
  selector: 'app-login',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  authService = inject(AuthService);

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
}

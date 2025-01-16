import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { FormContainerComponent } from '../form-container/form-container.component';
import { CommonModule } from '@angular/common';
import { MatError, MatLabel, MatFormField } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-signin',
  templateUrl: './signin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
      .form-field {
        width: 100%;
      }
    `,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormContainerComponent,
    MatInput,
    MatError,
    MatLabel,
    MatFormField,
    MatButtonModule,
  ],
})
export class SigninComponent implements OnInit {
  authService = inject(AuthService);

  form!: FormGroup;

  ngOnInit(): void {
    this.form = new FormGroup({
      email: new FormControl('', [Validators.email]),
      password: new FormControl('', [Validators.minLength(6)]),
    });
  }

  signIn() {
    console.log('signin with: ', this.form.value);
    this.authService.signIn(this.form.value);
  }
}

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
import {
  MatError,
  MatFormField,
  MatInput,
  MatLabel,
} from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .form-field {
      width: 100%;
    }
    .goto-link {
      margin-left: 15px;
    }
  `,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    FormContainerComponent,
    MatInput,
    MatError,
    MatLabel,
    MatFormField,
    MatButtonModule,
  ],
})
export class SignupComponent implements OnInit {
  authService = inject(AuthService);

  form!: FormGroup;

  ngOnInit(): void {
    this.form = new FormGroup({
      displayName: new FormControl('', [Validators.minLength(3)]),
      email: new FormControl('', [Validators.email]),
      password: new FormControl('', [Validators.minLength(6)]),
    });
  }

  signUp() {
    console.log('signup with: ', this.form.value);
    // this.authService.signUp(this.form.value);
  }
}

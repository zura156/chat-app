import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
  WritableSignal,
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
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { PlaceholderDirective } from '../../../../shared/directives/placeholder/placeholder.directive';
import { AlertComponent } from '../../../../shared/components/alert/alert.component';
import { AuthRequestI } from '../../interfaces/auth-request.interface';
import { HttpErrorResponse } from '@angular/common/http';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';

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
    PlaceholderDirective,
    MatInput,
    MatError,
    MatLabel,
    MatFormField,
    MatButtonModule,
    LoadingSpinnerComponent,
  ],
})
export class SignupComponent implements OnInit, OnDestroy {
  authService = inject(AuthService);
  router = inject(Router);

  form!: FormGroup;

  isLoading: WritableSignal<boolean> = signal(false);

  @ViewChild(PlaceholderDirective, { static: false })
  alertHost!: PlaceholderDirective;
  private closeSub!: Subscription;

  ngOnInit(): void {
    this.form = new FormGroup({
      email: new FormControl('', [Validators.email]),
      password: new FormControl('', [Validators.minLength(6)]),
    });
  }

  signUp() {
    if (this.form.valid) {
      this.isLoading.set(true);
      const credentials: AuthRequestI = this.form.getRawValue();

      this.authService.signup(credentials).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigateByUrl('signin');
        },
        error: (err) => {
          this.isLoading.set(false);
          this.showErrorAlert(err);
        },
      });
    }
  }

  ngOnDestroy(): void {
    if (this.closeSub) {
      this.closeSub.unsubscribe();
    }
  }

  private showErrorAlert(message: string) {
    const hostViewContainerRef = this.alertHost.viewContainerRef;
    hostViewContainerRef.clear();

    const componentRef = hostViewContainerRef.createComponent(AlertComponent);

    componentRef.instance.message = message;
    this.closeSub = componentRef.instance.close.subscribe(() => {
      this.closeSub.unsubscribe();
      hostViewContainerRef.clear();
    });
  }
}

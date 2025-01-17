import {
  ChangeDetectionStrategy,
  Component,
  inject,
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
import { MatError, MatLabel, MatFormField } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { PlaceholderDirective } from '../../../../shared/directives/placeholder/placeholder.directive';
import { Subscription } from 'rxjs';
import { AlertComponent } from '../../../../shared/components/alert/alert.component';
import { AuthRequestI } from '../../interfaces/auth-request.interface';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { LoadingSpinnerComponent } from '../../../../shared/components/loading-spinner/loading-spinner.component';

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
    PlaceholderDirective,
    MatInput,
    MatError,
    MatLabel,
    MatFormField,
    MatButtonModule,
    LoadingSpinnerComponent,
  ],
})
export class SigninComponent implements OnInit {
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

  signIn() {
    if (this.form.valid) {
      this.isLoading.set(true);
      const credentials: AuthRequestI = this.form.getRawValue();

      this.authService.login(credentials).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigateByUrl('chat');
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

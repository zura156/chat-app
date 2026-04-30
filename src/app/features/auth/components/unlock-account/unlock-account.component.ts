import { Component, inject, signal } from '@angular/core';
import {
  ReactiveFormsModule,
  FormGroup,
  FormControl,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NgIconComponent, provideIcons } from '@ng-icons/core';
import {
  lucideLoader,
  lucideTriangleAlert,
  lucideCircleCheck,
  lucideLockOpen,
} from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { AuthService } from '../../services/auth.service';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmIconImports } from '@spartan-ng/helm/icon';

@Component({
  selector: 'app-unlock-account',
  templateUrl: './unlock-account.component.html',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    HlmButtonImports,
    HlmAlertImports,
    HlmFieldImports,
    HlmInputImports,
    NgIconComponent,
    HlmIconImports,
  ],
  providers: [
    provideIcons({
      lucideLoader,
      lucideTriangleAlert,
      lucideCircleCheck,
      lucideLockOpen,
    }),
  ],
})
export class UnlockAccountComponent {
  private authService = inject(AuthService);

  isLoading = signal(false);
  error = signal<string | null>(null);
  success = signal(false);

  form = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
  });

  clearError() {
    this.error.set(null);
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.error.set(null);
    this.success.set(false);

    // this.authService.unlockAccount(this.form.value.email!).subscribe({
    //   next: () => {
    //     this.success.set(true);
    //     this.isLoading.set(false);
    //     this.form.reset();
    //   },
    //   error: (err) => {
    //     this.error.set(err?.error?.message ?? 'Something went wrong.');
    //     this.isLoading.set(false);
    //   },
    // });
  }
}

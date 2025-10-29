import { Component, computed, inject, OnInit } from '@angular/core';
import { UserStateService } from '../../../services/user-state.service';
import { HlmFormFieldImports } from '@spartan-ng/helm/form-field';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { lucideUpload } from '@ng-icons/lucide';
import { HlmItemImports } from '@spartan-ng/helm/item';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { TimeAgoPipe } from '../../../../../shared/pipes/time-ago.pipe';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toast } from 'ngx-sonner';

@Component({
  selector: 'user-profile-settings',
  templateUrl: './profile-settings.html',
  imports: [
    HlmCardImports,
    HlmFormFieldImports,
    HlmAvatarImports,
    HlmSeparatorImports,
    HlmItemImports,
    HlmIconImports,
    NgIcon,
    HlmInput,
    HlmTextarea,
    HlmButton,
    ReactiveFormsModule,
    TimeAgoPipe,
    HlmLabelImports,
  ],
  providers: [provideIcons({ lucideUpload })],
})
export class ProfileSettings implements OnInit {
  userStateService = inject(UserStateService);
  currentUser = computed(this.userStateService.currentUser);

  form = new FormGroup({
    username: new FormControl<string>('', [
      Validators.minLength(3),
      Validators.maxLength(20),
    ]),
    first_name: new FormControl<string>('', [
      Validators.minLength(3),
      Validators.maxLength(20),
    ]),
    last_name: new FormControl<string>('', [
      Validators.minLength(3),
      Validators.maxLength(20),
    ]),
    bio: new FormControl<string>('', [Validators.maxLength(500)]),
  });

  ngOnInit(): void {}

  uploadProfilePicture() {}

  onSubmit(): void {
    if (this.form.invalid) {
      toast.error('Please fix the errors in the form before submitting.');
      return;
    }
    toast.success('Profile updated successfully!');
  }
}

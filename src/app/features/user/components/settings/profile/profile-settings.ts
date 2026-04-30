import { Component, computed, inject, signal } from '@angular/core';
import { UserStateService } from '../../../services/user-state.service';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmTextarea } from '@spartan-ng/helm/textarea';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import {
  lucideCamera,
  lucideLockKeyhole,
  lucideLogOut,
  lucideUpload,
} from '@ng-icons/lucide';
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
import { toast } from '@spartan-ng/brain/sonner';
import { ImageCropperComponent } from 'ngx-smart-cropper';
import { base64ToFile } from '../../../../../shared/functions/base64-to-file';
import { FileMetadata } from '../../../../../shared/interfaces/file-metadata.interface';
import { catchError, EMPTY, tap } from 'rxjs';
import { UserService } from '../../../services/user.service';
import { UpdateProfilePictureI } from '../../../interfaces/update-profile-picture.interface';
import { UpdateProfileDataI } from '../../../interfaces/update-profile-data.interface';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../auth/services/auth.service';

@Component({
  selector: 'user-profile-settings',
  templateUrl: './profile-settings.html',
  imports: [
    RouterLink,
    HlmCardImports,
    HlmFieldImports,
    HlmAvatarImports,
    HlmSeparatorImports,
    HlmItemImports,
    HlmIconImports,
    NgIcon,
    ImageCropperComponent,
    HlmInput,
    HlmTextarea,
    HlmButton,
    ReactiveFormsModule,
    TimeAgoPipe,
    HlmLabelImports,
  ],
  styleUrl: './profile-settings.css',
  providers: [
    provideIcons({
      lucideUpload,
      lucideCamera,
      lucideLogOut,
      lucideLockKeyhole,
    }),
  ],
})
export class ProfileSettings {
  private userService = inject(UserService);
  private userStateService = inject(UserStateService);
  private authService = inject(AuthService);

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

  selectedImageSrc = signal<string | null>(null);
  selectedFileMetadata = signal<FileMetadata | null>(null);

  logOut(): void {
    this.authService.logOut().subscribe();
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file.');
      return;
    }

    if (file) {
      const metadata = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified),
      };

      if (metadata.size > 5 * 1024 * 1024) {
        toast.error('File size exceeds the 5MB limit.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.selectedImageSrc.set(e.target.result);
        this.selectedFileMetadata.set(metadata);
      };
      reader.readAsDataURL(file);
    }
  }

  uploadProfilePicture(imgSrc: string): void {
    if (!imgSrc) {
      this.selectedImageSrc.set(null);
      toast.info('Image selection was cancelled', {
        description: 'No image was selected for the conversation.',
      });
      return;
    }

    const file = base64ToFile(imgSrc, 'pfp.png');

    const userId = this.currentUser()?._id;
    const metadata = this.selectedFileMetadata();
    if (!userId || !metadata) {
      toast.error('User ID or file metadata is missing.');
      return;
    }
    const updateProfilePictureBody: UpdateProfilePictureI = {
      userId,
      profilePicture: file,
    };

    this.userService
      .updateProfilePicture(updateProfilePictureBody)
      .pipe(
        catchError((error) => {
          toast.error('Failed to update profile picture.', error.error.message);
          return EMPTY;
        }),
        tap(() => this.selectedImageSrc.set(null)),
      )
      .subscribe();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      toast.error('Please fix the errors in the form before submitting.');
      return;
    }

    const currentUser = this.currentUser();
    const updatedData: Partial<UpdateProfileDataI> = {};

    const requiredFields = ['first_name', 'last_name', 'username'] as const;

    // Handle required fields (no empty strings allowed)
    for (const field of requiredFields) {
      const control = this.form.controls[field];
      const newValue = this.form.value[field]?.trim();
      const currentValue = currentUser?.[field];

      if (control.touched && newValue && newValue !== currentValue) {
        updatedData[field] = newValue;
      }
    }

    // Handle bio separately (empty strings allowed)
    const bioControl = this.form.controls.bio;
    const bioValue = this.form.value.bio?.trim() ?? '';
    const currentBio = currentUser?.bio ?? '';

    if (bioControl.touched && bioValue !== currentBio) {
      updatedData.bio = bioValue;
    }

    if (Object.keys(updatedData).length === 0) {
      toast.info('No changes to save.');
      return;
    }
    this.userService.updateProfile(updatedData).subscribe({
      next: () => {
        this.form.reset();
        toast.success('Profile updated successfully!');
      },
      error: (error) => {
        toast.error('Failed to update profile.', error.error.message);
      },
    });
  }
}

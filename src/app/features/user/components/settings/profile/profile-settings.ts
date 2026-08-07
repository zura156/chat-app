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
import { lucideCamera, lucideLogOut, lucideUpload } from '@ng-icons/lucide';
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
import { UpdateProfileDataI } from '../../../interfaces/update-profile-data.interface';
import { AuthService } from '../../../../auth/services/auth.service';
import {
  FilePicker,
  FilePickerConfig,
  MAX_SIZE_MB,
} from '../../../../upload/file-picker/file-picker';
import {
  applyServerFieldErrors,
  clearServerFieldErrors,
  markFormGroupTouched,
  summarizeFormErrors,
} from '../../../../../shared/functions/form.utils';
import { apiErrorMessage } from '../../../../../shared/functions/api-error';

/** The server's `USERNAME_PATTERN`, restated so the form can refuse first. */
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

/** How the fields are named in a sentence, rather than as control keys. */
const FIELD_LABELS: Record<string, string> = {
  username: 'Username',
  first_name: 'First name',
  last_name: 'Last name',
  bio: 'Bio',
};

@Component({
  selector: 'user-profile-settings',
  templateUrl: './profile-settings.html',
  imports: [
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
    FilePicker,
  ],
  styleUrl: './profile-settings.css',
  providers: [
    provideIcons({
      lucideUpload,
      lucideCamera,
      lucideLogOut,
    }),
  ],
})
export class ProfileSettings {
  private userService = inject(UserService);
  private userStateService = inject(UserStateService);
  private authService = inject(AuthService);

  /** No `maxSizeMb` override: the picker's own limit is the server's. */
  readonly AVATAR_CONFIG: FilePickerConfig = { context: 'avatar' };

  /** Quoted in the message below, so the two can never drift apart. */
  readonly avatarMaxMb = MAX_SIZE_MB['avatar'] ?? 20;

  currentUser = computed(this.userStateService.currentUser);

  /*
   * These mirror `FIELD_LIMITS` and `USERNAME_PATTERN` in the API's
   * user.controller. They did not: every field claimed a 20-character ceiling
   * the server sets at 32 or 64, the names demanded 3 characters where the
   * server asks for 1, and the username's character rule was absent entirely.
   *
   * The consequence was worse here than on the sign-up form, because the
   * template's only message was the static line "3–20 characters" printed under
   * every input regardless of what was actually wrong — so a username rejected
   * for containing a space was answered with a sentence about length.
   */
  form = new FormGroup({
    username: new FormControl<string>('', [
      Validators.minLength(3),
      Validators.maxLength(32),
      Validators.pattern(USERNAME_PATTERN),
    ]),
    first_name: new FormControl<string>('', [Validators.maxLength(64)]),
    last_name: new FormControl<string>('', [Validators.maxLength(64)]),
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
      // Names what was actually picked — "Please select a valid image file" is
      // a puzzle when the thing you picked has a picture on its icon (.heic,
      // .svg, a .pdf of a scan).
      toast.error(
        `"${file.name}" is not an image the app can use. Choose a JPEG, PNG or WebP.`,
      );
      return;
    }

    if (file) {
      const metadata = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified),
      };

      if (metadata.size > this.avatarMaxMb * 1024 * 1024) {
        toast.error(
          `"${file.name}" is ${(metadata.size / (1024 * 1024)).toFixed(
            1,
          )}MB, over the ${this.avatarMaxMb}MB limit.`,
        );
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
      return;
    }

    const file = base64ToFile(imgSrc, 'pfp.png');

    const userId = this.currentUser()?._id;
    if (!userId) {
      toast.error('User ID is missing.');
      return;
    }

    this.userService
      .uploadProfilePicture(file)
      .pipe(
        tap(() => this.selectedImageSrc.set(null)),
        catchError((error) => {
          toast.error('Failed to update profile picture', {
            // Was `error?.error?.message ?? error?.message`, whose fallback is
            // Angular's transport boilerplate — so a rejected upload showed
            // "Http failure response for …/upload/presign: 400 Bad Request"
            // in place of the server's "That file is 24MB, over the 20MB
            // limit".
            description: apiErrorMessage(error, 'Please try again.'),
          });
          return EMPTY;
        }),
      )
      .subscribe();
  }

  onSubmit(): void {
    clearServerFieldErrors(this.form);

    if (this.form.invalid) {
      // Was "Please fix the errors in the form before submitting." — which
      // names neither the field nor the error, on a form whose inputs all
      // carried the same static hint.
      markFormGroupTouched(this.form);
      toast.error('Some details need fixing', {
        description: summarizeFormErrors(this.form, FIELD_LABELS),
      });
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
      /*
       * Two faults in one line. `toast.error(title, description)` is not the
       * signature — sonner's second argument is an options object, so the
       * reason was passed as an unrecognised option and never rendered: the
       * user saw "Failed to update profile." and nothing else, for a refusal
       * the server had explained precisely ("That username is already taken").
       * And `error.error.message` dereferences a body that is absent on any
       * network-level failure, so being offline threw a TypeError inside the
       * error handler and produced no toast at all.
       */
      error: (err) => {
        applyServerFieldErrors(this.form, err);
        toast.error('Failed to update profile', {
          description: apiErrorMessage(err, 'Please try again.'),
        });
      },
    });
  }
}

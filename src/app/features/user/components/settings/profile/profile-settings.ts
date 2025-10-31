import { Component, computed, inject, OnInit, signal } from '@angular/core';
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
import { ImageCropperComponent } from 'ngx-smart-cropper';
import { base64ToFile } from '../../../../../shared/functions/base64-to-file';
import { FileMetadata } from '../../../../../shared/interfaces/file-metadata.interface';
import { catchError, EMPTY, switchMap } from 'rxjs';
import { UserService } from '../../../services/user.service';
import { FileUploadService } from '../../../../../shared/services/file-upload.service';
import { UpdateProfilePictureI } from '../../../interfaces/update-profile-picture.interface';

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
    ImageCropperComponent,
    HlmInput,
    HlmTextarea,
    HlmButton,
    ReactiveFormsModule,
    TimeAgoPipe,
    HlmLabelImports,
  ],
  styleUrl: './profile-settings.css',
  providers: [provideIcons({ lucideUpload })],
})
export class ProfileSettings implements OnInit {
  private userService = inject(UserService);
  private fileUploadService = inject(FileUploadService);
  private userStateService = inject(UserStateService);
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

  ngOnInit(): void {}

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (file) {
      const metadata = {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: new Date(file.lastModified),
      };
      console.log('File metadata:', metadata);

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

    console.log(imgSrc);
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
        switchMap(({ url, profilePicture }) =>
          this.fileUploadService.uploadFile(url, profilePicture.data)
        )
      )
      .subscribe();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      toast.error('Please fix the errors in the form before submitting.');
      return;
    }
    toast.success('Profile updated successfully!');
  }
}

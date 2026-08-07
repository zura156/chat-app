import { Component, input, output } from '@angular/core';
import { ModalStatesT } from '../../interfaces/modal-states.type';
import { HlmButton } from '@spartan-ng/helm/button';
import { ModalVariantsT } from '../../interfaces/modal-variants.type';
import { UserI } from '../../../features/user/interfaces/user.interface';
import { ParticipantI } from '../../../features/messages/interfaces/participant.interface';
import {
  HlmAvatar,
  HlmAvatarFallback,
  HlmAvatarImage,
} from '@spartan-ng/helm/avatar';
import { environment } from '../../../../environments/environment';
import { HttpErrorResponse } from '@angular/common/http';
import { toast } from '@spartan-ng/brain/sonner';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { summarizeFormErrors } from '../../functions/form.utils';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import {
  lucideCheck,
  lucideSearch,
  lucideUsers,
  lucideX,
} from '@ng-icons/lucide';

@Component({
  selector: 'app-item-manager',
  templateUrl: './item-manager.html',
  imports: [
    ReactiveFormsModule,
    HlmButton,
    HlmAvatarImage,
    HlmAvatar,
    HlmAvatarFallback,
    HlmSeparatorImports,
    NgIcon,
    HlmIcon,
  ],
  providers: [
    provideIcons({ lucideSearch, lucideUsers, lucideX, lucideCheck }),
  ],
})
export class ItemManagerComponent {
  headerText = input<string>();
  description = input<string>();
  variant = input<ModalVariantsT>('user-list');
  error = input<HttpErrorResponse>();
  isLoading = input<boolean>();
  isSubmitting = input<boolean>();
  submitVariant = input<'default' | 'destructive'>('default');
  actionName = input<string>('submit');
  items = input<(UserI | ParticipantI)[]>();
  form = input<FormGroup>();

  closed = output<void>();
  submit = output<any>();
  state = input<ModalStatesT>('closed');

  animationEnd = output<void>();

  readonly apiUrl = environment.apiUrl;

  checkedBoxIds: Set<number> = new Set<number>([]);

  toggleCheckbox(index: number): void {
    if (this.isChecked(index)) {
      this.checkedBoxIds.delete(index);
    } else {
      this.checkedBoxIds.add(index);
    }
  }

  onSubmit(): void {
    const currentForm = this.form();

    if (this.variant() === 'confirmation') {
      this.submit.emit([]);
      return;
    }

    if (this.variant() === 'form') {
      if (!currentForm) {
        return;
      }
      if (currentForm.valid) {
        this.submit.emit(currentForm.value);
      } else {
        this.markFormGroupTouched(currentForm);
        // "Check all required fields and try again" describes what to do
        // without saying which field or what rule it broke — and this modal is
        // the only thing on screen, so there is nowhere else to look it up.
        toast.error('Please correct the form errors', {
          description: summarizeFormErrors(currentForm),
        });
      }
      return;
    }

    let selectedItemIds: string[] = [];
    const items = this.items();

    if (!items || !items.length) {
      toast.error('Submission was cancelled', {
        description: 'due to nothing being selected',
      });
      return;
    }

    for (let i of this.checkedBoxIds) {
      selectedItemIds.push(items[i]._id);
    }

    this.submit.emit(selectedItemIds);
    this.checkedBoxIds.clear();
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();

      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  isChecked(index: number) {
    return this.checkedBoxIds.has(index);
  }
}

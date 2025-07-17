import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { ModalStatesT } from '../../interfaces/modal-states.type';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { ModalVariantsT } from '../../interfaces/modal-variants.type';
import { UserI } from '../../../features/user/interfaces/user.interface';
import { ParticipantI } from '../../../features/messages/interfaces/participant.interface';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/helm/avatar';
import { environment } from '../../../../environments/environment';
import { HlmSeparatorDirective } from '../../../../../libs/ui/ui-separator-helm/src/lib/hlm-separator.directive';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HttpErrorResponse } from '@angular/common/http';
import { HlmSpinnerComponent } from '@spartan-ng/helm/spinner';
import { toast } from 'ngx-sonner';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-item-manager',
  templateUrl: './item-manager.component.html',
  imports: [
    ReactiveFormsModule,
    HlmButtonDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmSpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemManagerComponent {
  headerText = input<string>();
  description = input<string>();
  variant = input<ModalVariantsT>('user-list');
  error = input<HttpErrorResponse>();
  isLoading = input<boolean>();
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
        toast.error('Please correct the form errors', {
          description: 'Check all required fields and try again.',
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

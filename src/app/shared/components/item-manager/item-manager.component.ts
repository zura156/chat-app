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

@Component({
  selector: 'app-item-manager',
  templateUrl: './item-manager.component.html',
  imports: [
    HlmButtonDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmSpinnerComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ItemManagerComponent {
  headerText = input<string>();
  description = input<string>();
  variant = input<ModalVariantsT>('user-list');
  error = input<HttpErrorResponse>();
  isLoading = input<boolean>();

  items = input<(UserI | ParticipantI)[]>();

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
    let selectedItemIds: string[] = [];
    const items = this.items();

    if (!items) {
      this.submit.emit([]);
      return;
    }

    for (let i of this.checkedBoxIds) {
      selectedItemIds.push(items[i]._id);
    }

    this.submit.emit(selectedItemIds);
  }

  isChecked(index: number) {
    return this.checkedBoxIds.has(index);
  }
}

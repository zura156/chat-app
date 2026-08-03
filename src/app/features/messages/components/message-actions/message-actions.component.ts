import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  BrnAlertDialog,
  BrnAlertDialogContent,
  BrnAlertDialogDescription,
  BrnAlertDialogTitle,
} from '@spartan-ng/brain/alert-dialog';
import { BrnSheetContent } from '@spartan-ng/brain/sheet';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucidePencil, lucideTrash2 } from '@ng-icons/lucide';
import { MessageActionsService } from '../../services/message-actions.service';
import { UserStateService } from '../../../user/services/user-state.service';

/**
 * The touch action sheet and the delete confirmation, rendered once for the
 * whole conversation rather than once per message. See MessageActionsService
 * for why the two entry points are split.
 */
@Component({
  selector: 'app-message-actions',
  imports: [
    NgIcon,
    HlmIcon,
    HlmButton,
    HlmSpinner,
    HlmSheetImports,
    BrnSheetContent,
    BrnAlertDialog,
    BrnAlertDialogContent,
    BrnAlertDialogTitle,
    BrnAlertDialogDescription,
  ],
  providers: [provideIcons({ lucidePencil, lucideCopy, lucideTrash2 })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './message-actions.component.html',
})
export class MessageActionsComponent {
  protected readonly actions = inject(MessageActionsService);
  protected readonly currentUser = inject(UserStateService).currentUser;
}

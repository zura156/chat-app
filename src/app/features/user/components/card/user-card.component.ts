import { Component, inject, input } from '@angular/core';
import { UserI } from '../../../../shared/interfaces/user.interface';
import { LayoutService } from '../../../messages/layout/layout.service';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/ui-avatar-helm';

@Component({
  selector: 'app-user-card',
  imports: [
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmCardDirective,
  ],
  templateUrl: './user-card.component.html',
})
export class UserCardComponent {
  user = input<UserI>();
  imageUrl = this.user()?.profile_picture;

  switchView(): void {
    inject(LayoutService).switchView();
  }

  startConversation(): void {}
}

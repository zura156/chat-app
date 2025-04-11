import { Component, inject, input } from '@angular/core';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
import { ConversationI } from '../interfaces/conversation.interface';
import { RouterLink } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { HlmIconModule } from '../../../../../libs/ui/ui-icon-helm/src/index';
import { HlmIconDirective } from '../../../../../libs/ui/ui-icon-helm/src/lib/hlm-icon.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUsersRound } from '@ng-icons/lucide';
import { NgFor } from '@angular/common';
import {
  HlmAvatarComponent,
  HlmAvatarImageDirective,
} from '@spartan-ng/ui-avatar-helm';
import { UserService } from '../../user/services/user.service';

@Component({
  selector: 'app-conversation-card',
  imports: [
    HlmCardDirective,
    RouterLink,
    HlmIconModule,
    NgIcon,
    HlmIconDirective,
    NgFor,

    HlmAvatarImageDirective,
    HlmAvatarComponent,
  ],
  providers: [provideIcons({ lucideUsersRound })],
  templateUrl: './conversation-card.component.html',
})
export class ConversationCardComponent {
  layoutService = inject(LayoutService);

  userService = inject(UserService);

  conversation = input<ConversationI>();
  currentUser = this.userService.currentUser

  imageUrl = this.conversation()?.group_picture;

  switchView(): void {
    this.layoutService.switchView();
  }
}

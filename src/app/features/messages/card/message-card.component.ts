import { Component, inject, input } from '@angular/core';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/ui-avatar-helm';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
import { ConversationI } from '../interfaces/conversation.interface';
import { RouterLink } from '@angular/router';
import { LayoutService } from '../layout/layout.service';

@Component({
  selector: 'app-message-card',
  imports: [
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmCardDirective,
    RouterLink,
  ],
  templateUrl: './message-card.component.html',
})
export class MessageCardComponent {
  conversation = input.required<ConversationI>();

  imageUrl = this.conversation().group_picture;

  switchView(): void {
    inject(LayoutService).switchView();
  }
}

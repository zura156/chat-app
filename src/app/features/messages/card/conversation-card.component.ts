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

@Component({
  selector: 'app-conversation-card',
  imports: [
    HlmCardDirective,
    RouterLink,
    HlmIconModule,
    NgIcon,
    HlmIconDirective,
    NgFor,
  ],
  providers: [provideIcons({ lucideUsersRound })],
  templateUrl: './conversation-card.component.html',
})
export class ConversationCardComponent {
  layoutService = inject(LayoutService);

  conversation = input<ConversationI>();

  imageUrl = this.conversation()?.group_picture;

  switchView(): void {
    this.layoutService.switchView();
  }
}

import { Component, inject, input } from '@angular/core';
import { ConversationI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import {
  lucideChevronDown,
  lucideChevronUp,
  lucideCircleUserRound,
  lucideDoorOpen,
  lucideMenu,
  lucideMessageCircle,
  lucidePencil,
  lucideUserRoundMinus,
} from '@ng-icons/lucide';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
} from '@spartan-ng/helm/avatar';
import { BrnMenuTriggerDirective } from '@spartan-ng/brain/menu';
import {
  HlmMenuComponent,
  HlmMenuGroupComponent,
  HlmMenuItemDirective,
  HlmMenuItemIconDirective,
  HlmMenuSeparatorComponent,
} from '@spartan-ng/helm/menu';
import { Router, RouterLink } from '@angular/router';
import { ConversationService } from '../services/conversation.service';
import { ParticipantI } from '../interfaces/participant.interface';
import { HlmButtonDirective } from '@spartan-ng/helm/button';

@Component({
  selector: 'app-chatbox-settings',
  imports: [
    NgIcon,
    RouterLink,
    HlmIconDirective,
    HlmAvatarImageDirective,
    BrnMenuTriggerDirective,
    HlmMenuItemIconDirective,
    HlmMenuItemDirective,
    HlmButtonDirective,
    HlmMenuComponent,
    HlmMenuGroupComponent,
    HlmMenuSeparatorComponent,
    HlmAvatarComponent,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideChevronUp,
      lucidePencil,
      lucideDoorOpen,
      lucideMenu,
      lucideMessageCircle,
      lucideCircleUserRound,
      lucideUserRoundMinus,
    }),
  ],
  templateUrl: './chatbox-settings.component.html',
  styleUrl: './chatbox-settings.component.css',
})
export class ChatboxSettingsComponent {
  conversation = input<ConversationI>();
  conversationService = inject(ConversationService);
  router = inject(Router);

  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: { [key: string]: boolean } = {
    chatInfo: false,
    members: false,
  };
  openUserMenuIndex: number | null = null;

  toggleDropdown(menu: string): void {
    this.dropdownMenuStates[menu] = !this.dropdownMenuStates[menu];
  }

  toggleUserMenu(index: number): void {
    if (this.openUserMenuIndex === index) {
      this.openUserMenuIndex = null;
    } else {
      this.openUserMenuIndex = index;
    }
  }

  isOpen(menu: string): boolean {
    return this.dropdownMenuStates[menu];
  }

  onMessageMember(participant: ParticipantI): void {
    const conversationId =
      this.conversationService
        .conversationList()
        ?.conversations?.filter((c) => !c.is_group)
        ?.find((conversation) =>
          conversation.participants.some((p) => p._id === participant._id)
        )?._id || null;

    if (conversationId) {
      this.router.navigate(['/messages', conversationId]);
    } else {
      this.conversationService.selectUserForConversation(participant);
      this.conversationService.createMockConversation();
    }
  }

  onChatNameChange(): void {}

  onAddMembers(): void {}

  onRemoveMember(user_id: string): void {}

  onLeaveGroup(): void {}
}

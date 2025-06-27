import { Component, input } from '@angular/core';
import { ConversationI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import {
  lucideChevronDown,
  lucideChevronUp,
  lucideDoorOpen,
  lucideMenu,
  lucidePencil,
} from '@ng-icons/lucide';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
} from '@spartan-ng/ui-avatar-helm';

@Component({
  selector: 'app-chatbox-settings',
  imports: [
    NgIcon,
    HlmIconDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideChevronUp,
      lucidePencil,
      lucideDoorOpen,
      lucideMenu,
    }),
  ],
  templateUrl: './chatbox-settings.component.html',
  styleUrl: './chatbox-settings.component.css',
})
export class ChatboxSettingsComponent {
  conversation = input<ConversationI>();

  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: { [key: string]: boolean } = {
    chatInfo: false,
    members: false,
  };

  toggleDropdown(menu: string): void {
    this.dropdownMenuStates[menu] = !this.dropdownMenuStates[menu];
  }

  toggleUserMenu(index: number): void {}

  isOpen(menu: string): boolean {
    return this.dropdownMenuStates[menu];
  }

  onChatNameChange(): void {}

  onAddMembers(): void {}

  onLeaveGroup(): void {}
}

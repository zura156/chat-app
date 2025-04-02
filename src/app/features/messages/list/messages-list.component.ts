import { Component, inject, OnInit, signal } from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucidePencil } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { ConversationService } from '../services/conversation.service';
import { NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { UserService } from '../../user/services/user.service';

@Component({
  selector: 'app-messages-list',
  imports: [
    MessageCardComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmInputDirective,
    HlmButtonDirective,
    NgIcon,
    HlmIconDirective,
    NgIf,
    NgFor,
    RouterLink,
  ],
  providers: [provideIcons({ lucidePencil, lucideMenu })],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent implements OnInit {
  conversationService = inject(ConversationService);
  userService = inject(UserService);

  conversations = this.conversationService.conversations;
  users = this.userService.users;

  userListView = signal<boolean>(false);

  ngOnInit(): void {}

  // Function to fetch conversations
  getConversations(): void {
    this.conversationService.getConversations().subscribe();
  }

  searchForUsers(): void {
    this.userListView.set(true);
  }

  fetchUser(): void {}

  searchUser(): void {}
}

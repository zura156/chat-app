import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideMenu, lucidePencil } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { ConversationService } from '../services/conversation.service';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmBadgeDirective } from '@spartan-ng/ui-badge-helm';
import { UserService } from '../../user/services/user.service';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import { ClickOutsideDirective } from '../../../shared/directives/click-outside.directive';

@Component({
  selector: 'app-messages-list',
  imports: [
    HlmBadgeDirective,
    MessageCardComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmInputDirective,
    HlmButtonDirective,
    UserCardComponent,
    HlmIconDirective,
    NgIcon,
    NgIf,
    NgFor,
    NgClass,
    RouterLink,
  ],
  providers: [provideIcons({ lucidePencil, lucideMenu, lucideChevronLeft })],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent implements OnInit {
  conversationService = inject(ConversationService);
  userService = inject(UserService);

  conversations = this.conversationService.conversations;
  users = this.userService.users;

  userListView = signal<boolean>(false);

  query = signal<string>('');

  setQuery(value: any): void {
    if (value as HTMLInputElement) {
      this.query.set(value.target.value);
    }
    if (this.query().length > 0 && !this.userListView()) {
      this.userListView.set(true);
    }
  }

  constructor() {
    effect(() => {
      if (this.query()) {
        this.searchUsers(this.query());
      }
    });
  }

  ngOnInit(): void {
    this.fetchUsers();
  }

  // Function to fetch conversations
  getConversations(): void {
    this.conversationService.getConversations().subscribe();
  }

  searchForUsers(): void {
    this.userListView.set(true);
  }

  switchToConversationView(): void {
    this.userListView.set(false);
  }

  fetchUsers(): void {
    this.userService.fetchUsers().subscribe();
  }

  searchUsers(query: string): void {
    this.userService.searchUser(query).subscribe();
  }
}

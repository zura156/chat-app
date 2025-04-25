import { Component, computed, effect, inject, signal } from '@angular/core';
import { ConversationCardComponent } from '../card/conversation-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideLoader,
  lucideMenu,
  lucidePencil,
} from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { ConversationService } from '../services/conversation.service';
import { NgFor, NgIf } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmBadgeDirective } from '@spartan-ng/ui-badge-helm';
import { UserService } from '../../user/services/user.service';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import {
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UserI } from '../../../shared/interfaces/user.interface';
import {
  HlmTabsComponent,
  HlmTabsListComponent,
  HlmTabsTriggerDirective,
  HlmTabsContentDirective,
} from '@spartan-ng/ui-tabs-helm';
import { LayoutService } from '../layout/layout.service';
import { HlmSkeletonComponent } from '@spartan-ng/ui-skeleton-helm';

@Component({
  selector: 'app-messages-list',
  imports: [
    HlmTabsComponent,
    HlmTabsListComponent,
    HlmTabsTriggerDirective,
    HlmTabsContentDirective,

    HlmBadgeDirective,
    ConversationCardComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmInputDirective,
    HlmButtonDirective,
    UserCardComponent,
    HlmIconDirective,
    ReactiveFormsModule,
    NgIcon,
    NgIf,
    NgFor,
    RouterLink,

    HlmSkeletonComponent,
  ],
  providers: [
    provideIcons({ lucidePencil, lucideMenu, lucideChevronLeft, lucideLoader }),
  ],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent {
  // Injected services
  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private router = inject(Router);
  private layoutService = inject(LayoutService);

  // State signals
  readonly activeView = this.layoutService.activeView;
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  // Form control for search
  readonly searchControl = new FormControl<string>('');

  // Main data
  readonly conversations = this.conversationService.conversationList;
  readonly users = this.userService.users;

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

  constructor() {
    effect(() => {
      const query = this.searchQuery();

      switch (this.activeView()) {
        case 'conversations':
          this.fetchConversations(query);
          break;
        case 'users':
          this.fetchUsers(query);
          break;
        default:
          break;
      }
    });
  }

  ngOnInit(): void {
    this.searchForData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // View switching methods
  switchToConversations(): void {
    this.layoutService.setActiveView('conversations');
    this.searchControl.setValue('');
  }

  switchToUsers(): void {
    this.layoutService.setActiveView('users');
    this.searchControl.setValue('');
  }

  // Navigation methods
  navigateToNewConversation(): void {
    this.layoutService.switchView();
    this.layoutService.setActiveView('chatbox');
    this.router.navigate(['/messages/new']);
  }

  navigateToConversation(id: string): void {
    this.router.navigate(['/messages', id]);
  }

  // User selection - for creating a new conversation
  selectUser(user: UserI): void {
    // Find if there's an existing conversation with this user
    const existingConversation = this.conversations()?.conversations.find(
      (conv) =>
        !conv.is_group && conv.participants.some((p) => p._id === user._id)
    );

    if (existingConversation) {
      this.navigateToConversation(existingConversation._id);
    } else {
      // Create new conversation or navigate to new conversation view with this user pre-selected
      this.router.navigate(['/messages/new'], {
        queryParams: { userId: user._id },
      });
    }

    this.layoutService.switchView();
  }

  private searchForData(): void {
    this.searchControl.valueChanges
      .pipe(
        takeUntil(this.destroy$),
        debounceTime(300),
        distinctUntilChanged(),
        tap((query) => {
          this.searchQuery.set(query || '');
          console.log(query);
        }),
        switchMap((query) => {
          if (query) {
            console.log(this.activeView());
            switch (this.activeView()) {
              case 'conversations':
                return this.conversationService
                  .searchConversations(query)
                  .pipe(tap(() => console.log(this.conversations())));
              case 'users':
                return this.userService.searchUsers(query);
              default:
                return EMPTY;
            }
          } else {
            return EMPTY;
          }
        })
      )
      .subscribe();
  }

  private fetchConversations(query: string = ''): void {
    // this.isLoading.set(true);
  }

  private fetchUsers(query: string = ''): void {
    // this.isLoading.set(true);
  }
}

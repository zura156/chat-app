import { Component, computed, effect, inject, signal } from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
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
import { NgClass, NgFor, NgIf } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmBadgeDirective } from '@spartan-ng/ui-badge-helm';
import { UserService } from '../../user/services/user.service';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ConversationI } from '../interfaces/conversation.interface';
import { UserI } from '../../../shared/interfaces/user.interface';

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
    ReactiveFormsModule,
    NgIcon,
    NgIf,
    NgFor,
    NgClass,
    RouterLink,
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

  // State signals
  readonly activeView = signal<'conversations' | 'users'>('conversations');
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  // Form control for search
  readonly searchControl = new FormControl<string>('');

  // Data signals with computed values for the views
  readonly #conversations = signal<ConversationI[]>([]);
  readonly #filteredConversations = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.#conversations();

    return this.#conversations().filter((conversation) => {
      // For group conversations
      if (conversation.is_group && conversation.group_name) {
        return conversation.group_name.toLowerCase().includes(query);
      }

      // For direct conversations
      return conversation.participants.some(
        (participant) =>
          `${participant.first_name} ${participant.last_name}`
            .toLowerCase()
            .includes(query) ||
          participant.username.toLowerCase().includes(query)
      );
    });
  });

  readonly #users = signal<UserI[]>([]);
  readonly #filteredUsers = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.#users();

    return this.#users().filter(
      (user) =>
        `${user.first_name} ${user.last_name}`.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query)
    );
  });

  // Expose computed values for template
  readonly conversations = this.#filteredConversations;
  readonly users = this.#filteredUsers;

  // Cache settings
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
  private lastConversationsUpdate = 0;
  private lastUsersUpdate = 0;

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

  constructor() {
    // Setup effect to handle search changes
    effect(() => {
      const view = this.activeView();
      const query = this.searchQuery();

      if (view === 'conversations') {
        this.fetchConversationsIfNeeded(query);
      } else {
        this.fetchUsersIfNeeded(query);
      }
    });
  }

  ngOnInit(): void {
    this.setupSearchListener();
    this.fetchInitialData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // View switching methods
  switchToConversations(): void {
    this.activeView.set('conversations');
    this.searchControl.setValue('');
  }

  switchToUsers(): void {
    this.activeView.set('users');
    this.searchControl.setValue('');
  }

  // Navigation methods
  navigateToNewConversation(): void {
    this.router.navigate(['/messages/new']);
  }

  navigateToConversation(id: string): void {
    this.router.navigate(['/messages', id]);
  }

  // User selection - for creating a new conversation
  selectUser(user: UserI): void {
    // Find if there's an existing conversation with this user
    const existingConversation = this.#conversations().find(
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
  }

  // Data fetching methods with caching
  private fetchInitialData(): void {
    this.fetchConversationsIfNeeded();
  }

  private fetchConversationsIfNeeded(query: string = ''): void {
    const currentTime = Date.now();
    const cacheExpired =
      currentTime - this.lastConversationsUpdate > this.CACHE_DURATION;

    // Skip fetch if we have recent data and no query
    if (!cacheExpired && this.#conversations().length > 0 && !query) {
      return;
    }

    this.isLoading.set(true);

    // Choose whether to search or get all conversations
    const request$ = query
      ? this.conversationService.searchConversations(query)
      : this.conversationService.getConversations();

    request$
      .pipe(
        takeUntil(this.destroy$),
        catchError((err) => {
          this.error.set('Failed to load conversations');
          console.error('Error fetching conversations:', err);
          this.isLoading.set(false);
          return EMPTY;
        })
      )
      .subscribe((result) => {
        if (!query) {
          // Only update cache timestamp for non-search requests
          this.lastConversationsUpdate = currentTime;
        }
        this.#conversations.set(result.conversations || result);
        this.isLoading.set(false);
      });
  }

  private fetchUsersIfNeeded(query: string = ''): void {
    const currentTime = Date.now();
    const cacheExpired =
      currentTime - this.lastUsersUpdate > this.CACHE_DURATION;

    // Skip fetch if we have recent data and no query
    if (!cacheExpired && this.#users().length > 0 && !query) {
      return;
    }

    this.isLoading.set(true);

    // Choose whether to search or get all users
    const request$ = query
      ? this.userService.searchUsers(query)
      : this.userService.fetchUsers();

    request$
      .pipe(
        takeUntil(this.destroy$),
        catchError((err) => {
          this.error.set('Failed to load users');
          console.error('Error fetching users:', err);
          this.isLoading.set(false);
          return EMPTY;
        })
      )
      .subscribe((result) => {
        if (!query) {
          // Only update cache timestamp for non-search requests
          this.lastUsersUpdate = currentTime;
        }
        this.#users.set(result.users || result);
        this.isLoading.set(false);
      });
  }

  // Search functionality
  private setupSearchListener(): void {
    this.searchControl.valueChanges
      .pipe(
        takeUntil(this.destroy$),
        startWith(''),
        debounceTime(300),
        distinctUntilChanged(),
        tap((query) => {
          this.searchQuery.set(query || '');
        })
      )
      .subscribe();
  }

  // Helper method for refreshing data
  refreshData(): void {
    if (this.activeView() === 'conversations') {
      this.lastConversationsUpdate = 0; // Force cache refresh
      this.fetchConversationsIfNeeded();
    } else {
      this.lastUsersUpdate = 0; // Force cache refresh
      this.fetchUsersIfNeeded();
    }
  }
}

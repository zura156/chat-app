import { Component, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideLoader,
  lucideMenu,
  lucideMessageCircleDashed,
  lucidePencil,
  lucideUsers,
} from '@ng-icons/lucide';
import { ConversationService } from '../../services/conversation.service';
import { Router, RouterLink } from '@angular/router';
import { UserService } from '../../../user/services/user.service';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  Observable,
  of,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  tap,
  } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UserI } from '../../../user/interfaces/user.interface';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { LayoutService } from '../../services/layout.service';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { ConversationListI } from '../../interfaces/conversation-list.interface';
import { UserListI } from '../../../user/interfaces/user-list.interface';
import { toObservable } from '@angular/core/rxjs-interop';
import { WebSocketMessageT } from '../../interfaces/web-socket-message.interface';
import { WebSocketService } from '../../services/web-socket.service';
import { ConversationI } from '../../interfaces/conversation.interface';
import { ActiveListViewType } from '../../interfaces/active-view.types';
import { HttpErrorResponse } from '@angular/common/http';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { ConversationCardComponent } from '../card/conversation-card.component';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmButton } from '@spartan-ng/helm/button';
import { UserCardComponent } from '../../../user/components/card/user-card.component';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { MessageI } from '../../interfaces/message.interface';

@Component({
  selector: 'app-conversation-list',
  imports: [
    HlmTabsImports,
    HlmBadge,
    HlmSeparatorImports,
    HlmInput,
    HlmButton,
    HlmIcon,
    NgIcon,
    RouterLink,
    HlmSkeleton,
    UserCardComponent,
    ConversationCardComponent,
    ReactiveFormsModule,
  ],
  providers: [
    provideIcons({
      lucidePencil,
      lucideMenu,
      lucideChevronLeft,
      lucideLoader,
      lucideUsers,
      lucideMessageCircleDashed,
    }),
  ],
  templateUrl: './conversation-list.component.html',
  styles: [':host{display:block;height:100%}'],
})
export class ConversationListComponent {
  // Injected services
  private conversationService = inject(ConversationService);
  private webSocketService = inject(WebSocketService);

  //* I decided to not  use user state service, *//
  //* since i also use functions from user service *//
  private userService = inject(UserService);

  private router = inject(Router);
  private layoutService = inject(LayoutService);

  // State signals
  readonly activeListView = this.layoutService.activeListView;
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  // Form control for search
  readonly searchControl = new FormControl<string>('');

  // Main data
  readonly conversations = this.conversationService.conversationList;
  readonly users = this.userService.users;
  readonly currentUser = this.userService.currentUser;

  activeListView$: Observable<ActiveListViewType> = toObservable(
    this.activeListView,
  );

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

  // whether the cached list currently holds search results rather than the
  // full list — see fetchConversations()/fetchUsers()
  private lastLoadWasSearch = false;
  private lastUserLoadWasSearch = false;

  // 5 placeholders; values don't matter—array length does
  placeholders = Array.from({ length: 5 });

  ngOnInit(): void {
    this.searchForData();

    // exactly one websocket subscription for the lifetime of the component —
    // it used to be subscribed here *and* re-subscribed inside searchForData,
    // so every event was handled twice and this one outlived the component
    this.handleWebSocketMessages()
      .pipe(takeUntil(this.destroy$))
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // View switching methods
  switchToConversations(): void {
    this.layoutService.setActiveListView('conversations');
    this.searchControl.setValue('');
  }

  switchToUsers(): void {
    this.layoutService.setActiveListView('users');
    this.searchControl.setValue('');
  }

  // Navigation methods
  navigateToNewConversation(): void {
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
        !conv.is_group && conv.participants.some((p) => p._id === user._id),
    );

    if (existingConversation) {
      this.navigateToConversation(existingConversation._id);
    } else {
      // Create new conversation or navigate to new conversation view with this user pre-selected
      this.conversationService.selectUserForConversation(user);
      this.router.navigate(['/messages', user._id]);
    }
  }

  private searchForData(): void {
    combineLatest([
      this.searchControl.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        distinctUntilChanged(),
      ),
      this.activeListView$,
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(([query]) => {
          this.searchQuery.set(query || '');
        }),
        switchMap(([query, view]) => {
          switch (view) {
            case 'users':
              return this.fetchUsers(query || '');
            case 'conversations':
            default:
              return this.fetchConversations(query || '');
          }
        }),
      )
      .subscribe();
  }

  private fetchConversations(
    query: string = '',
  ): Observable<ConversationListI> {
    // The cache is only reusable if it holds the *full* list. After a search it
    // holds the filtered result, so clearing the box has to refetch.
    if (
      !query &&
      !this.lastLoadWasSearch &&
      this.conversations()?.conversations.length
    ) {
      return of(this.conversations() as ConversationListI);
    }

    this.isLoading.set(true);
    this.lastLoadWasSearch = !!query;

    const request$ = query
      ? this.conversationService.searchConversations(query)
      : this.conversationService.getConversations();

    return request$.pipe(
      takeUntil(this.destroy$),
      catchError((err) => this.handleError(err)),
      tap(() => this.isLoading.set(false)),
    );
  }

  private fetchUsers(query: string = ''): Observable<UserListI> {
    // Skip fetch if we have the full list cached and there is no query
    if (!query && !this.lastUserLoadWasSearch && this.users()?.users.length) {
      return of(this.users() as UserListI);
    }

    this.isLoading.set(true);
    this.lastUserLoadWasSearch = !!query;

    // Choose whether to search or get all users
    const request$ = query
      ? this.userService.searchUsers(query)
      : this.userService.fetchUsers();

    return request$.pipe(
      takeUntil(this.destroy$),
      catchError((err) => this.handleError(err)),
      tap(() => this.isLoading.set(false)),
    );
  }

  private handleWebSocketMessages(): Observable<WebSocketMessageT> {
    return (
      this.webSocketService.onMessage().pipe(
        tap((res) => {
          switch (res.type) {
            case 'message':
              const message: MessageI = res.message;
              const conversation: string | ConversationI = message.conversation;

              if (!message || !conversation) {
                return;
              }

              this.conversationService.setLastMessageInConversation(
                typeof conversation === 'string'
                  ? conversation
                  : conversation._id,
                message,
              );

              return;
            // The sidebar's copy of `last_message` is maintained here, so a
            // delete has to reach this handler too — the chatbox only owns the
            // open thread. Arrives for every conversation the user is in, not
            // just the visible one.
            case 'message-deleted':
              this.conversationService.applyDeletedToLastMessage(
                res.message._id,
                res.message.deleted_at,
              );
              break;
            case 'conversation-update':
              this.conversationService.updateConversationState(
                res.conversation,
              );
              break;
            case 'conversation-join':
              const { added_by, conversation: joinedConversation } = res;

              if (added_by?._id === this.currentUser()?._id) {
                break;
              } else {
                this.conversationService.addConversationToList(
                  joinedConversation as ConversationI,
                );
              }
              break;

            case 'conversation-leave':
              const { conversation: left, removed_users } = res;
              const currentUserId = this.currentUser()?._id;

              const isCurrentUserRemoved = removed_users?.some(
                (u: any) =>
                  (typeof u === 'string' ? u : u._id) === currentUserId,
              );

              if (isCurrentUserRemoved) {
                this.conversationService.removeConversationFromList(
                  left as ConversationI,
                );
                this.router.navigate(['/messages']);
              } else {
                this.conversationService.updateConversationState(
                  left as ConversationI,
                );
              }
              break;
          }
        }),
        catchError((err) => this.handleError(err)),
      ) || EMPTY
    );
  }

  /**
   * EMPTY rather than throwError: this sits on the long-lived search and
   * websocket streams, and re-throwing killed them permanently — one failed
   * request and search stopped working until a reload.
   */
  private handleError(
    err: HttpErrorResponse,
    navigation: boolean = false,
  ): Observable<never> {
    console.error('[conversation-list]', err);
    this.isLoading.set(false);
    if (navigation) {
      this.router.navigate(['/messages']);
    }
    return EMPTY;
  }
}

import {
  Component,
  computed,
  effect,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
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

import { Router, RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmBadgeDirective } from '@spartan-ng/ui-badge-helm';
import { UserService } from '../../user/services/user.service';
import { UserCardComponent } from '../../user/components/card/user-card.component';
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
  throwError,
} from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UserI } from '../../user/interfaces/user.interface';
import {
  HlmTabsComponent,
  HlmTabsListComponent,
  HlmTabsTriggerDirective,
  HlmTabsContentDirective,
} from '@spartan-ng/ui-tabs-helm';
import { LayoutService } from '../layout/layout.service';
import { HlmSkeletonComponent } from '@spartan-ng/ui-skeleton-helm';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { UserListI } from '../../user/interfaces/user-list.interface';
import { toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from '../../auth/services/auth.service';
import { WebSocketMessageT } from '../interfaces/web-socket-message.interface';
import { WebSocketService } from '../services/web-socket.service';
import { ToastrService } from 'ngx-toastr';
import { ConversationI } from '../interfaces/conversation.interface';
import { ActiveViewType } from '../interfaces/active-view.type';

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
  private webSocketService = inject(WebSocketService);
  private toast = inject(ToastrService);
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
  readonly currentUser = this.userService.currentUser;

  activeView$: Observable<ActiveViewType> = toObservable(this.activeView);

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

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
      this.conversationService.selectUserForConversation(user);
      this.router.navigate(['/messages', user._id]);
    }
  }

  private searchForData(): void {
    combineLatest([
      this.searchControl.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        distinctUntilChanged()
      ),
      this.activeView$,
    ])
      .pipe(
        takeUntil(this.destroy$),
        tap(([query]) => {
          this.searchQuery.set(query || '');
        }),
        switchMap(([query, view]) => {
          switch (view) {
            case 'conversations':
              return this.fetchConversations(query || '').pipe(
                switchMap(() => this.handleWebSocketMessages())
              );
            case 'users':
              return this.fetchUsers(query || '');
            default:
              return EMPTY;
          }
        })
      )
      .subscribe();
  }

  private fetchConversations(
    query: string = ''
  ): Observable<ConversationListI> {
    if (
      this.conversations() &&
      this.conversations()?.conversations.length! > 0 &&
      !query
    ) {
      return of(this.conversations() as ConversationListI);
    }

    this.isLoading.set(true);

    const request$ = query
      ? this.conversationService.searchConversations(query)
      : this.conversationService.getConversations();

    return request$.pipe(
      takeUntil(this.destroy$),
      catchError((err) => this.handleError(err)),
      tap(() => this.isLoading.set(false))
    );
  }

  private fetchUsers(query: string = ''): Observable<UserListI> {
    // Skip fetch if we have recent data and no query
    if (this.users() && this.users()?.users.length! > 0 && !query) {
      return of(this.users() as UserListI);
    }

    this.isLoading.set(true);

    // Choose whether to search or get all users
    const request$ = query
      ? this.userService.searchUsers(query)
      : this.userService.fetchUsers();

    return request$.pipe(
      takeUntil(this.destroy$),
      catchError((err) => this.handleError(err)),
      tap(() => this.isLoading.set(false))
    );
  }

  private handleWebSocketMessages(): Observable<WebSocketMessageT> {
    return (
      this.webSocketService.onMessage()?.pipe(
        tap((res) => {
          switch (res.type) {
            case 'conversation-join':
              const {
                added_by,
                added_user,
                conversation: joinedConversation,
              } = res;

              if (added_by._id === this.currentUser()?._id) {
                break;
              } else {
                this.conversationService.addConversationToList(
                  joinedConversation as ConversationI
                );
              }
              break;

            case 'conversation-leave':
              const {
                removed_by,
                removed_user,
                conversation: leftConversation,
              } = res;

              this.conversationService.removeConversationFromList(
                leftConversation as ConversationI
              );
              break;
          }
        }),
        catchError((err) => this.handleError(err))
      ) || EMPTY
    );
  }

  private handleError(
    err: any,
    navigation: boolean = false
  ): Observable<never> {
    this.isLoading.set(false);
    this.toast.error('Something went wrong!', err.message);
    if (navigation) {
      this.router.navigate(['/messages']);
    }
    return throwError(() => err);
  }
}

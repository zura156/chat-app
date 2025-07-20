import { Component, inject, signal } from '@angular/core';
import { ConversationCardComponent } from '../card/conversation-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideChevronLeft,
  lucideLoader,
  lucideMenu,
  lucidePencil,
} from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { ConversationService } from '../services/conversation.service';

import { RouterLink } from '@angular/router';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { HlmBadgeDirective } from '@spartan-ng/helm/badge';
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
} from '@spartan-ng/helm/tabs';
import { LayoutService } from '../layout/layout.service';
import { HlmSkeletonComponent } from '@spartan-ng/helm/skeleton';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { UserListI } from '../../user/interfaces/user-list.interface';
import { toObservable } from '@angular/core/rxjs-interop';
import { WebSocketMessageT } from '../interfaces/web-socket-message.interface';
import { WebSocketService } from '../services/web-socket.service';
import { ConversationI } from '../interfaces/conversation.interface';
import { ActiveViewType } from '../interfaces/active-view.type';
import { NavController } from '@ionic/angular/standalone';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-conversation-list',
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
  templateUrl: './conversation-list.component.html',
})
export class ConversationListComponent {
  // Injected services
  private conversationService = inject(ConversationService);
  private webSocketService = inject(WebSocketService);
  private userService = inject(UserService);
  private navCtrl = inject(NavController);
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
    this.navCtrl.navigateRoot(['/messages/new']);
  }

  navigateToConversation(id: string): void {
    this.navCtrl.navigateRoot(['/messages', id]);
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
      this.navCtrl.navigateRoot(['/messages', user._id]);
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
            case 'users':
              return this.fetchUsers(query || '');
            case 'conversations':
            default:
              return this.fetchConversations(query || '').pipe(
                switchMap(() => this.handleWebSocketMessages())
              );
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
                conversation: joinedConversation,
              } = res;

              if (added_by?._id === this.currentUser()?._id) {
                break;
              } else {
                this.conversationService.addConversationToList(
                  joinedConversation as ConversationI
                );
              }
              break;

            case 'conversation-leave':
              const {
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
    err: HttpErrorResponse,
    navigation: boolean = false
  ): Observable<never> {
    this.isLoading.set(false);
    if (navigation) {
      this.navCtrl.navigateRoot(['/messages']);
    }
    return throwError(() => err);
  }
}

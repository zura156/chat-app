import { Component, effect, inject, signal } from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronLeft, lucideMenu, lucidePencil } from '@ng-icons/lucide';
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
  providers: [provideIcons({ lucidePencil, lucideMenu, lucideChevronLeft })],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent {
  conversationService = inject(ConversationService);
  userService = inject(UserService);
  router = inject(Router);

  conversations = this.conversationService.conversations;
  users = this.userService.users;

  userListView = signal<boolean>(false);

  // Signals for reactive state management
  protected readonly isLoading = signal(true);
  protected readonly searchControl = new FormControl<string>('');

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.configureConversationStream();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  getConversations(): void {
    this.conversationService
      .getConversations()
      .pipe(takeUntil(this.destroy$))
      .subscribe();
  }

  searchForUsers(): void {
    this.userListView.set(true);
  }

  switchToConversationView(): void {
    this.userListView.set(false);
    this.searchControl.reset();
  }

  fetchUsers(): void {
    this.userService.fetchUsers().subscribe();
  }

  private configureConversationStream(): void {
    const search$ = this.searchControl.valueChanges.pipe(
      takeUntil(this.destroy$),
      startWith(''),
      debounceTime(300),
      distinctUntilChanged(),
      tap(() => this.isLoading.set(true))
    );

    this.isLoading.set(true);

    search$
      .pipe(
        switchMap((query) => {
          if (this.userListView()) {
            return this.userService.searchUsers(query || '').pipe(
              takeUntil(this.destroy$),
              catchError(() => {
                this.isLoading.set(false);
                return EMPTY;
              }),
              tap(() => {
                this.isLoading.set(false);
              })
            );
          } else {
            return this.conversationService
              .searchConversations(query || '')
              .pipe(
                takeUntil(this.destroy$),
                catchError(() => {
                  this.isLoading.set(false);
                  return EMPTY;
                }),
                tap(() => {
                  this.isLoading.set(false);
                })
              );
          }
        })
      )
      .subscribe();
  }

  onNewConversation(): void {
    this.router.navigate(['/messages/new']);
    // this.conversationService.createMockConversation();
  }
}

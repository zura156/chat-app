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
import { RouterLink } from '@angular/router';
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

  getConversations(): void {
    this.conversationService.getConversations().subscribe();
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
    // Setting up observables for search and filter
    const search$ = this.searchControl.valueChanges.pipe(
      startWith(''), // Start with an empty query to fetch all recipes initially
      debounceTime(300), // Wait for 300ms before processing the latest value
      distinctUntilChanged(), // Only emit if the search term has changed
      tap(() => this.isLoading.set(true))
    );

    this.isLoading.set(true);

    search$
      .pipe(
        takeUntil(this.destroy$),
        switchMap((query) => {
          if (this.userListView()) {
            return this.userService.searchUsers(query || '').pipe(
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
}

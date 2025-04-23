import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import {
  catchError,
  EMPTY,
  map,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { UserI } from '../../../shared/interfaces/user.interface';
import { NgFor, NgIf } from '@angular/common';
import { NgScrollbarModule } from 'ngx-scrollbar';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import { ClickOutsideDirective } from '../../../shared/directives/click-outside.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';

@Component({
  selector: 'app-new-chat',
  imports: [
    NgIf,
    NgFor,
    ReactiveFormsModule,

    HlmSeparatorDirective,
    BrnSeparatorComponent,

    HlmInputDirective,

    NgScrollbarModule,

    UserCardComponent,

    ClickOutsideDirective,

    HlmIconDirective,
    NgIcon,

    HlmButtonDirective,
  ],
  providers: [provideIcons({ lucideX })],
  templateUrl: './new-chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewChatComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);

  readonly showUserList = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  // Form control for search
  readonly searchControl = new FormControl<string>('');

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
  readonly users = this.#filteredUsers;
  readonly selectedUsers = signal<UserI[]>([]);

  // Cache settings
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
  private lastUsersUpdate = 0;

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

  constructor() {
    effect(() => {
      const query = this.searchQuery();
      if (query) {
        this.fetchUsersIfNeeded(query);
      }
    });
  }

  ngOnInit(): void {
    this.route.queryParams
      .pipe(
        takeUntil(this.destroy$),
        map((params) => params['userId']),
        switchMap((userId) => {
          if (!userId) {
            return this.router.navigateByUrl('/messages/new');
          }
          return this.conversationService
            .createConversation([
              this.userService.currentUser()?._id ?? '',
              userId,
            ])
            .pipe(
              tap((conversation) => {
                this.router.navigateByUrl(`/messages/${conversation._id}`);
              })
            );
        })
      )
      .subscribe();
  }

  createConversation() {
    const selectedUsersIds = [
      this.userService.currentUser()!._id,
      ...this.selectedUsers().map((u) => u._id),
    ];

    let isGroup = false;

    if (selectedUsersIds.length > 2) {
      isGroup = true;
    }

    this.conversationService
      .createConversation(selectedUsersIds, isGroup)
      .pipe(
        tap((conversation) => {
          this.router.navigateByUrl(`/messages/${conversation._id}`);
        })
      )
      .subscribe();
  }

  addToConversation(user: UserI): void {
    this.searchControl.reset();
    if (!this.selectedUsers().includes(user)) {
      this.selectedUsers.update((val) => [...val, user]);
      this.#users.update((val) => val.filter((u) => u._id !== user._id));
    }
  }

  removeFromConversation(user: UserI): void {
    if (this.selectedUsers().includes(user)) {
      this.selectedUsers.update((val) => val.filter((u) => u._id !== user._id));
      this.#users.update((val) => [...val, user]);
    }
  }

  toggleUserList(): void {
    this.showUserList.update((value) => !value);
    this.isLoading.set(true);
    this.fetchUsersIfNeeded();
  }

  closeUserList(): void {
    this.showUserList.set(false);
  }

  private fetchUsersIfNeeded(query: string = ''): void {
    this.searchControl.reset();
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

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
import { Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  Subject,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import { UserI } from '../../user/interfaces/user.interface';
import { NgScrollbarModule } from 'ngx-scrollbar';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import { ClickOutsideDirective } from '../../../shared/directives/click-outside.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideX } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmLabelDirective } from '@spartan-ng/helm/label';
import { HlmErrorDirective } from '@spartan-ng/helm/form-field';
import { NavController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-new-chat',
  imports: [
    ReactiveFormsModule,
    HlmSeparatorDirective,
    HlmLabelDirective,
    HlmInputDirective,
    HlmErrorDirective,
    NgScrollbarModule,
    UserCardComponent,
    ClickOutsideDirective,
    HlmIconDirective,
    NgIcon,
    HlmButtonDirective,
  ],
  providers: [provideIcons({ lucideX, lucideCircleAlert })],
  templateUrl: './new-chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewChatComponent implements OnInit, OnDestroy {
  private readonly navCtrl = inject(NavController);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);

  userListFlag = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  searchQuery = signal<string>('');

  // Form control for search
  searchControl = new FormControl<string>('');
  groupNameControl = new FormControl<string>('', [
    Validators.minLength(3),
    Validators.maxLength(32),
  ]);

  #users = signal<UserI[]>([]);
  #filteredUsers = computed(() => {
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
    this.searchControl.valueChanges
      .pipe(
        debounceTime(300),
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        map((q) => q?.toString()),
        tap((q) => this.fetchUsersIfNeeded(q))
      )
      .subscribe();
  }

  onSubmit(): void {
    const currentUser = this.userService.currentUser();
    const selectedUsers = this.selectedUsers();

    if (!currentUser || selectedUsers.length === 0) return;

    if (selectedUsers.length === 1) {
      const targetUserId = selectedUsers[0]._id;
      const allConversations =
        this.conversationService.conversationList()?.conversations || [];

      const existingConversation = allConversations.find((c) => {
        const participantIds = c.participants.map((p) => p._id);
        return (
          c.participants.length === 2 &&
          participantIds.includes(currentUser._id) &&
          participantIds.includes(targetUserId)
        );
      });

      if (existingConversation) {
        this.navCtrl.navigateRoot('/messages/' + existingConversation._id);
      } else {
        this.conversationService.selectUserForConversation(selectedUsers[0]);
        this.navCtrl.navigateRoot(['/messages/', targetUserId]);
      }
    } else {
      this.createConversation();
    }
  }

  createConversation() {
    this.isLoading.set(true);

    const selectedUsersIds = [
      this.userService.currentUser()!._id,
      ...this.selectedUsers().map((u) => u._id),
    ];

    let isGroup = false;

    if (selectedUsersIds.length > 2) {
      isGroup = true;
    }

    this.conversationService
      .createConversation(
        selectedUsersIds,
        isGroup,
        this.groupNameControl.value ?? ''
      )
      .pipe(
        takeUntil(this.destroy$),
        tap((conversation) => {
          this.navCtrl.navigateRoot(`/messages/${conversation._id}`);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          this.isLoading.set(false);
          return throwError(() => err);
        })
      )
      .subscribe();
  }

  addToConversation(user: UserI): void {
    this.searchControl.reset();
    if (!this.selectedUsers().some((u) => u._id === user._id)) {
      this.selectedUsers.update((val) => [...val, user]);
      this.#users.update((val) => val.filter((u) => u._id !== user._id));
    }
  }

  removeFromConversation(user: UserI): void {
    if (this.selectedUsers().some((u) => u._id === user._id)) {
      this.selectedUsers.update((val) => val.filter((u) => u._id !== user._id));
      this.#users.update((val) => [...val, user]);
    }
  }

  showUserList(): void {
    this.userListFlag.set(true);
    this.isLoading.set(true);
    this.fetchUsersIfNeeded();
  }

  closeUserList(): void {
    this.userListFlag.set(false);
  }

  isUserSelected(userId: string): boolean {
    if (!userId) return false;
    const selectedUserIds = this.selectedUsers().map((u) => u._id);
    return selectedUserIds.includes(userId);
  }

  private fetchUsersIfNeeded(query: string = ''): void {
    // Skip fetch if we have recent data and no query
    if (this.#users().length > 0 && !query) {
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
        this.#users.set(result.users || result);
        this.isLoading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

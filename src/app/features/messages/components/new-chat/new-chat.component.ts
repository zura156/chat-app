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
import { Router, RouterLink } from '@angular/router';
import { UserService } from '../../../user/services/user.service';
import { ConversationService } from '../../services/conversation.service';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  startWith,
  Subject,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSeparator } from '@spartan-ng/helm/separator';
import { UserI } from '../../../user/interfaces/user.interface';
import { ClickOutsideDirective } from '../../../../shared/directives/click-outside.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideCircleAlert,
  lucideMessageCircle,
  lucideMessageCirclePlus,
  lucidePlus,
  lucideSearch,
  lucideUserSearch,
  lucideX,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmError } from '@spartan-ng/helm/form-field';
import { ParticipantI } from '../../interfaces/participant.interface';
import { HlmAvatar, HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-new-chat',
  imports: [
    ReactiveFormsModule,
    HlmAvatarImports,
    HlmSeparator,
    HlmAvatar,
    RouterLink,
    HlmInput,
    HlmError,
    ClickOutsideDirective,
    HlmIcon,
    NgIcon,
    HlmButton,
  ],
  providers: [
    provideIcons({
      lucideX,
      lucideSearch,
      lucideCircleAlert,
      lucideArrowLeft,
      lucidePlus,
      lucideUserSearch,
      lucideMessageCirclePlus,
      lucideMessageCircle,
    }),
  ],
  templateUrl: './new-chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewChatComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);

  apiUrl = environment.apiUrl;

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
        user.email.toLowerCase().includes(query),
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
    const state = this.router.lastSuccessfulNavigation()?.extras.state;
    const preselected = state?.['preselectedUser'];
    if (preselected) {
      this.addToConversation(preselected);
      if (this.conversationService.conversationList()?.totalCount) {
        this.onSubmit();
      }
    }

    this.searchControl.valueChanges
      .pipe(
        startWith(''),
        debounceTime(300),
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        map((q) => q?.toString()),
        tap((q) => this.fetchUsersIfNeeded(q)),
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
        this.router.navigate(['/messages', existingConversation._id]);
      } else {
        const participant: ParticipantI = {
          _id: selectedUsers[0]._id,
          first_name: selectedUsers[0].first_name,
          last_name: selectedUsers[0].last_name,
          username: selectedUsers[0].username,
          blocked_users: selectedUsers[0].blocked_users,
          profile_picture: selectedUsers[0].profile_picture,
          last_seen: selectedUsers[0].last_seen,
          status: selectedUsers[0].status,
          bio: selectedUsers[0].bio,
        };
        this.conversationService.selectUserForConversation(participant);
        this.router.navigate(['/messages', targetUserId]);
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
        this.groupNameControl.value ?? '',
      )
      .pipe(
        takeUntil(this.destroy$),
        tap((conversation) => {
          this.router.navigate(['/messages', conversation._id]);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          this.isLoading.set(false);
          return throwError(() => err);
        }),
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
        }),
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

import {
  Component,
  computed,
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
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { ParticipantI } from '../../interfaces/participant.interface';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { environment } from '../../../../../environments/environment';
import { toast } from '@spartan-ng/brain/sonner';
import { apiErrorMessage } from '../../../../shared/functions/api-error';

@Component({
  selector: 'app-new-chat',
  imports: [
    ReactiveFormsModule,
    HlmAvatarImports,
    HlmSeparator,
    RouterLink,
    HlmInput,
    HlmFieldImports,
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
        user.username?.toLowerCase().includes(query),
    );
  });

  // Expose computed values for template
  readonly users = this.#filteredUsers;
  readonly selectedUsers = signal<UserI[]>([]);

  // Cleanup subject
  private readonly destroy$ = new Subject<void>();

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
        /*
         * Trimmed above `distinctUntilChanged`, not below it.
         *
         * A box holding only spaces is an empty search, not a search for
         * spaces — `fetchUsersIfNeeded` branches on exactly that and would
         * otherwise send the whitespace to the server as a query. Trimming
         * first also lets the dedupe do its job: "ada" and "ada " are the same
         * search, and comparing them untrimmed fetched twice for it.
         */
        map((q) => q?.toString().trim() ?? ''),
        distinctUntilChanged(),
        /*
         * `searchQuery` is what `#filteredUsers` narrows on, and nothing ever
         * wrote to it — so the local filter was a pass-through and the effect
         * that used to sit in the constructor fired once, with an empty string,
         * and never again. Setting it here makes the list narrow immediately
         * while the server's own search is still in flight.
         */
        tap((q) => {
          this.searchQuery.set(q);
          this.fetchUsersIfNeeded(q);
        }),
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
          pfp_url: selectedUsers[0].pfp_url,
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
    /*
     * `groupNameControl` carries minLength(3)/maxLength(32) and nothing ever
     * read `.valid` — a two-character group name went to the server and came
     * back as a refusal the form could have caught itself.
     */
    if (this.groupNameControl.invalid) {
      this.groupNameControl.markAsTouched();
      toast.error('Check the group name', {
        description: 'Use between 3 and 32 characters.',
      });
      return;
    }

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
        this.groupNameControl.value?.trim() ?? '',
      )
      .pipe(
        takeUntil(this.destroy$),
        tap((conversation) => {
          this.router.navigate(['/messages', conversation._id]);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          this.isLoading.set(false);
          /*
           * This branch reset the spinner and rethrew, and the `.subscribe()`
           * below took no error callback — so a refused conversation produced
           * nothing but an unhandled rejection in the console. The user pressed
           * the button, the spinner stopped, and the screen did not move. The
           * server's reasons here are all actionable ("You cannot start a
           * conversation with someone who has blocked you", "Group name is
           * required"), and none of them were ever shown.
           */
          toast.error('Could not start that conversation', {
            description: apiErrorMessage(err, 'Please try again.'),
          });
          return throwError(() => err);
        }),
      )
      .subscribe({ error: () => undefined });
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
          // "Failed to load users" covered a rate limit, an expired session and
          // being offline alike, with the distinguishing detail going to the
          // console.
          this.error.set(apiErrorMessage(err, 'Failed to load users.'));
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

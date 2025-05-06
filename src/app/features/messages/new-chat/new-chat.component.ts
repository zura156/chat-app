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
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { UserI } from '../../../shared/interfaces/user.interface';
import { NgFor, NgIf } from '@angular/common';
import { NgScrollbarModule } from 'ngx-scrollbar';
import { UserCardComponent } from '../../user/components/card/user-card.component';
import { ClickOutsideDirective } from '../../../shared/directives/click-outside.directive';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideX } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { toast } from 'ngx-sonner';
import { HlmToasterComponent } from '@spartan-ng/ui-sonner-helm';
import { HlmErrorDirective } from '@spartan-ng/ui-formfield-helm';

@Component({
  selector: 'app-new-chat',
  imports: [
    ReactiveFormsModule,

    NgIf,
    NgFor,

    HlmSeparatorDirective,

    HlmLabelDirective,

    HlmInputDirective,
    HlmErrorDirective,

    NgScrollbarModule,

    UserCardComponent,

    ClickOutsideDirective,

    HlmIconDirective,
    NgIcon,

    HlmToasterComponent,

    HlmButtonDirective,
  ],
  providers: [provideIcons({ lucideX, lucideCircleAlert })],
  templateUrl: './new-chat.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewChatComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);

  readonly userListFlag = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal<string>('');

  // Form control for search
  readonly searchControl = new FormControl<string>('');
  readonly groupNameControl = new FormControl<string>('', [
    Validators.minLength(3),
    Validators.maxLength(32),
  ]);

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
        distinctUntilChanged(),
        map((q) => q?.toString()),
        tap((q) => this.fetchUsersIfNeeded(q))
      )
      .subscribe();
  }

  onSubmit(): void {
    const selectedUsers = this.selectedUsers();

    toast.success('Something went wrong!', {
      description: 'test',
      duration: 5000,
      position: 'bottom-right',
    });
    if (!selectedUsers.length) return;

    if (selectedUsers.length < 2) {
      this.conversationService.selectUserForConversation(selectedUsers[0]);
      this.router.navigate(['/messages/', selectedUsers[0]._id]);
    } else {
      this.createConversation();
      return;
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
        tap((conversation) => {
          this.router.navigateByUrl(`/messages/${conversation._id}`);
          this.isLoading.set(false);
        }),
        catchError((err) => {
          toast.error('Something went wrong!', {
            description: err.error.message,
            duration: 5000,
            position: 'bottom-right',
          });
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
  // toggleUserList(): void {
  //   this.showUserList.update((value) => !value);
  //   this.isLoading.set(true);
  //   this.fetchUsersIfNeeded();
  // }

  closeUserList(): void {
    this.userListFlag.set(false);
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

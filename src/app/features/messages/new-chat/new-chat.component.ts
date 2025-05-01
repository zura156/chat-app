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
  Observable,
  of,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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
import { CreateConversationI } from '../interfaces/create-conversation.interface';
import { HlmLabelDirective } from '@spartan-ng/ui-label-helm';
import { UserListI } from '../../../shared/interfaces/user-list.interface';

@Component({
  selector: 'app-new-chat',
  imports: [
    ReactiveFormsModule,

    NgIf,
    NgFor,

    HlmSeparatorDirective,

    HlmLabelDirective,

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
  private readonly fb = inject(FormBuilder);
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
        map((q) => q?.toString()),
        switchMap((query) => this.fetchUsersIfNeeded(query))
      )
      .subscribe();
  }

  onSubmit(): void {}

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
    // if (!this.selectedUsers().map(u => u._id).includes(user._id)) {
    if (!this.selectedUsers().includes(user)) {
      console.log(this.selectedUsers());
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

  private fetchUsersIfNeeded(query: string = ''): Observable<UserListI> {
    this.searchControl.reset();

    // Skip fetch if we have recent data and no query
    if (this.#users().length > 0 && !query) {
      return of({ users: this.users(), totalCount: this.users().length });
    }

    this.isLoading.set(true);

    // Choose whether to search or get all users
    const request$ = query
      ? this.userService.searchUsers(query)
      : this.userService.fetchUsers();

    return request$.pipe(
      takeUntil(this.destroy$),
      catchError((err) => {
        this.error.set('Failed to load users');
        console.error('Error fetching users:', err);
        this.isLoading.set(false);
        return EMPTY;
      })
    );
    // .subscribe((result) => {
    //   this.#users.set(result.users || result);
    //   this.isLoading.set(false);
    // });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  inject,
  input,
  OnDestroy,
  output,
  OutputRefSubscription,
  signal,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { ConversationI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIcon } from '@spartan-ng/helm/icon';
import {
  lucideArrowLeft,
  lucideChevronDown,
  lucideChevronUp,
  lucideCircleUserRound,
  lucideDoorOpen,
  lucideMenu,
  lucideMessageCircle,
  lucidePencil,
  lucideUserRoundMinus,
  lucideUsersRound,
} from '@ng-icons/lucide';
import { HlmAvatarImage, HlmAvatar } from '@spartan-ng/helm/avatar';
import { BrnMenuTrigger } from '@spartan-ng/brain/menu';
import {
  HlmMenu,
  HlmMenuGroup,
  HlmMenuItem,
  HlmMenuItemIcon,
  HlmMenuSeparator,
} from '@spartan-ng/helm/menu';
import { ConversationService } from '../services/conversation.service';
import { ParticipantI } from '../interfaces/participant.interface';
import { HlmButton } from '@spartan-ng/helm/button';
import { ItemManagerComponent } from '../../../shared/components/item-manager/item-manager';
import { catchError, Subscription, tap, throwError } from 'rxjs';
import { UserService } from '../../user/services/user.service';
import { toast } from 'ngx-sonner';
import { MemberChangesI } from '../interfaces/member-changes.interface';
import { UserI } from '../../user/interfaces/user.interface';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { ImageCropperComponent } from 'ngx-smart-cropper';
import { base64ToFile } from '../../../shared/functions/base64-to-file';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { MediaFilesListComponent } from '../media-files-list/media-files-list.component';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-chatbox-settings',
  imports: [
    RouterLink,
    NgIcon,
    HlmTabsImports,
    ReactiveFormsModule,
    HlmIcon,
    HlmAvatarImage,
    BrnMenuTrigger,
    HlmMenuItemIcon,
    HlmMenuItem,
    HlmButton,
    HlmMenu,
    HlmMenuGroup,
    HlmMenuSeparator,
    HlmAvatar,
    ImageCropperComponent,
    HlmSpinner,
    MediaFilesListComponent,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideArrowLeft,
      lucideChevronUp,
      lucidePencil,
      lucideDoorOpen,
      lucideMenu,
      lucideMessageCircle,
      lucideCircleUserRound,
      lucideUserRoundMinus,
      lucideUsersRound,
    }),
  ],
  templateUrl: './chatbox-settings.component.html',
  styleUrl: './chatbox-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatboxSettingsComponent implements OnDestroy {
  conversation = input<ConversationI>();
  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  closeSettings = output<void>();

  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: { [key: string]: boolean } = {
    chatInfo: false,
    members: false,
  };
  openUserMenuIndex: number | null = null;

  modalVcr = viewChild('modalContainer', { read: ViewContainerRef });
  #modalComponentRef?: ComponentRef<ItemManagerComponent>;

  private subscriptions: (Subscription | OutputRefSubscription)[] = [];

  initialChatImageSrc = signal<string | null>(null);

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions = [];
  }

  toggleDropdown(menu: string): void {
    this.dropdownMenuStates[menu] = !this.dropdownMenuStates[menu];
  }

  toggleUserMenu(index: number): void {
    if (this.openUserMenuIndex === index) {
      this.openUserMenuIndex = null;
    } else {
      this.openUserMenuIndex = index;
    }
  }

  isOpen(menu: string): boolean {
    return this.dropdownMenuStates[menu];
  }

  onMessageMember(participant: ParticipantI): void {
    const conversationId =
      this.conversationService
        .conversationList()
        ?.conversations?.filter((c) => !c.is_group)
        ?.find((conversation) =>
          conversation.participants.some((p) => p._id === participant._id)
        )?._id || null;

    if (conversationId) {
      this.subscriptions.push(
        this.conversationService
          .findConversationIdByUserId(participant._id)
          .pipe(
            tap((res) =>
              this.router.navigate(['/messages', res.conversationId])
            )
          )
          .subscribe()
      );
    } else {
      this.conversationService.selectUserForConversation(participant);
      this.conversationService.createMockConversation();
    }
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error('File size exceeds the 5MB limit.');
        return;
      }
      if (!file.type.startsWith('image/')) {
        toast.error('Please select a valid image file.');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.initialChatImageSrc.set(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  onChatImageChange(imageSrc: string): void {
    this.initialChatImageSrc.set(null);
    if (!imageSrc) {
      toast.info('Image selection was cancelled', {
        description: 'No image was selected for the conversation.',
      });
      return;
    }

    const file = base64ToFile(imageSrc, 'chat-image.png');

    const conversationId = this.conversation()?._id;
    const updateGroupPictureBody = { group_picture: file };
    this.conversationService
      .updateConversation(String(conversationId), updateGroupPictureBody)
      .pipe(
        tap(() => {
          toast.success('Conversation updated successfully!', {
            description: 'Conversation picture changed.',
          });
        }),
        catchError((error) => {
          toast.error('Failed to update conversation picture', {
            description: error.message || 'Please try again later.',
          });
          return throwError(() => error);
        })
      )
      .subscribe();
  }

  onChatNameChange(): void {
    this.createComponent();

    // Set modal configuration
    this.#modalComponentRef?.setInput('headerText', 'Modify conversation name');
    this.#modalComponentRef?.setInput(
      'description',
      'Change the name of conversation to keep it organized and easily identifiable.'
    );
    this.#modalComponentRef?.setInput('variant', 'form');
    this.#modalComponentRef?.setInput('actionName', 'update');

    // Create form with validation
    const chatNameForm = this.fb.group({
      groupName: new FormControl(this.conversation()?.group_name || '', [
        Validators.minLength(1),
        Validators.maxLength(50),
        this.noOnlyWhitespaceValidator(),
      ]),
    });

    this.#modalComponentRef?.setInput('form', chatNameForm);

    // Handle form submission
    const submitSubscription =
      this.#modalComponentRef?.instance.submit.subscribe((formData: any) => {
        if (chatNameForm.valid) {
          const newGroupName = formData.groupName?.trim();

          if (newGroupName === this.conversation()?.group_name) {
            toast.info('No changes made', {
              description: 'The conversation name remains the same.',
            });
            this.#modalComponentRef?.instance.closed.emit();
            return;
          }

          this.#modalComponentRef?.setInput('isLoading', true);

          // Call your service method to update conversation name
          this.subscriptions.push(
            this.conversationService
              .updateConversation(String(this.conversation()?._id), {
                group_name: newGroupName,
              })
              .pipe(
                tap((response) => {
                  this.#modalComponentRef?.setInput('isLoading', false);
                  toast.success('Conversation name updated!', {
                    description: `Name changed to "${response.group_name}"`,
                  });
                  this.#modalComponentRef?.instance.closed.emit();
                }),
                catchError((error) => {
                  this.#modalComponentRef?.setInput('isLoading', false);
                  toast.error('Failed to update conversation name', {
                    description: error.message || 'Please try again later.',
                  });
                  return throwError(() => error);
                })
              )
              .subscribe()
          );
        } else {
          // Handle form validation errors
          this.markFormGroupTouched(chatNameForm);
          toast.error('Please correct the form errors', {
            description: 'Check the conversation name and try again.',
          });
        }
      });

    if (submitSubscription) {
      this.subscriptions.push(submitSubscription);
    }
  }

  // Custom validator for whitespace-only input
  private noOnlyWhitespaceValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      if (control.value && control.value.trim().length === 0) {
        return { whitespace: true };
      }
      return null;
    };
  }

  // Utility method to mark all form controls as touched
  private markFormGroupTouched(formGroup: FormGroup) {
    Object.keys(formGroup.controls).forEach((key) => {
      const control = formGroup.get(key);
      control?.markAsTouched();

      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  onAddMembers(): void {
    this.createComponent();

    this.#modalComponentRef?.setInput('headerText', 'Add members');
    this.#modalComponentRef?.setInput(
      'description',
      'Search and select the users you want to add to your conversation.'
    );
    this.#modalComponentRef?.setInput('variant', 'user-list');

    const users = this.userService.users()?.users;
    const participants = this.conversation()?.participants;

    this.#modalComponentRef?.setInput('isLoading', true);

    let filteredUsers: UserI[];

    if (!users?.length) {
      this.subscriptions.push(
        this.userService
          .fetchUsers()
          .pipe(
            catchError((err) => {
              this.#modalComponentRef?.setInput('isLoading', false);
              this.#modalComponentRef?.setInput('error', err);
              return throwError(() => err);
            }),
            tap((res) => {
              filteredUsers = res.users.filter(
                (user) => !participants?.map((p) => p._id).includes(user._id)
              );
              this.#modalComponentRef?.setInput('isLoading', false);
              this.#modalComponentRef?.setInput('items', filteredUsers);
            })
          )
          .subscribe()
      );
    } else {
      filteredUsers = users.filter(
        (user) => !participants?.map((p) => p._id).includes(user._id)
      );
      this.#modalComponentRef?.setInput('isLoading', false);
      this.#modalComponentRef?.setInput('items', filteredUsers);
    }

    const submitSubscription =
      this.#modalComponentRef?.instance.submit.subscribe((res: string[]) => {
        const memberChanges: MemberChangesI = { add: res, remove: [] };

        this.subscriptions.push(
          this.conversationService
            .manageConversationMembers(
              memberChanges,
              String(this.conversation()?._id)
            )
            .pipe(
              tap((response) => {
                toast.info('Members were added successfully!', {
                  description: `${this.formatUsernames(
                    response.participants?.filter((user) =>
                      res.includes(user._id)
                    ) || []
                  )} joined the ${
                    this.conversation()?.group_name || 'conversation'
                  }.`,
                });
                this.#modalComponentRef?.setInput(
                  'items',
                  filteredUsers.filter((u) => !res.includes(u._id))
                );
              })
            )
            .subscribe()
        );

        submitSubscription && this.subscriptions.push(submitSubscription);
      });
  }

  onRemoveMember(user: ParticipantI): void {
    this.createComponent();

    this.#modalComponentRef?.setInput('headerText', 'Are you sure?');
    this.#modalComponentRef?.setInput(
      'description',
      `Do you want to remove ${user.username} from conversation?`
    );
    this.#modalComponentRef?.setInput('variant', 'confirmation');
    this.#modalComponentRef?.setInput('submitVariant', 'destructive');
    this.#modalComponentRef?.setInput('actionName', 'remove');

    const submitSubscription =
      this.#modalComponentRef?.instance.submit.subscribe(() => {
        const memberChanges: MemberChangesI = {
          add: [],
          remove: [user._id],
        };

        this.subscriptions.push(
          this.conversationService
            .manageConversationMembers(
              memberChanges,
              String(this.conversation()?._id)
            )
            .pipe(
              tap(() => {
                toast.info(`Submission was successfull!`, {
                  description: `${user.username} was removed successfully!`,
                });
                this.#modalComponentRef?.instance.closed.emit();
              })
            )
            .subscribe()
        );

        submitSubscription && this.subscriptions.push(submitSubscription);
      });
  }

  onLeaveGroup(): void {
    this.createComponent();

    this.#modalComponentRef?.setInput('headerText', 'Are you sure?');
    this.#modalComponentRef?.setInput(
      'description',
      `Do you want to leave the conversation?`
    );
    this.#modalComponentRef?.setInput('variant', 'confirmation');
    this.#modalComponentRef?.setInput('submitVariant', 'destructive');
    this.#modalComponentRef?.setInput('actionName', 'leave');

    const submitSubscription =
      this.#modalComponentRef?.instance.submit.subscribe(() => {
        const currentUser = this.userService.currentUser();

        if (!currentUser) return;

        const memberChanges: MemberChangesI = {
          add: [],
          remove: [currentUser._id],
        };

        this.subscriptions.push(
          this.conversationService
            .manageConversationMembers(
              memberChanges,
              String(this.conversation()?._id)
            )
            .pipe(
              tap(() => {
                toast.info(`Submission was successfull!`, {
                  description: `${currentUser.username} was removed successfully!`,
                });
                this.#modalComponentRef?.instance.closed.emit();
              })
            )
            .subscribe()
        );

        submitSubscription && this.subscriptions.push(submitSubscription);
      });
  }

  private createComponent() {
    this.modalVcr()?.clear();

    this.#modalComponentRef =
      this.modalVcr()?.createComponent(ItemManagerComponent);

    this.#modalComponentRef?.setInput('state', 'open');

    const closedSubscription =
      this.#modalComponentRef?.instance.closed.subscribe(() => {
        this.#modalComponentRef?.setInput('state', 'closed');
        const animationEndSubscription =
          this.#modalComponentRef?.instance.animationEnd.subscribe(() => {
            this.#modalComponentRef?.destroy();

            animationEndSubscription &&
              this.subscriptions.push(animationEndSubscription);
            closedSubscription && this.subscriptions.push(closedSubscription);
          });
      });
  }

  private formatUsernames(users: { username: string }[]): string {
    if (!users || users.length === 0) return '';
    const names = users.map((u) => u.username);

    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }
}

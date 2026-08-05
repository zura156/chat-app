import {
  Component,
  ComponentRef,
  DestroyRef,
  inject,
  input,
  output,
  OutputRefSubscription,
  signal,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucideChevronDown,
  lucideChevronUp,
  lucideCircleUserRound,
  lucideDoorOpen,
  lucideEllipsis,
  lucideMenu,
  lucideMessageCircle,
  lucidePencil,
  lucideUserRoundMinus,
  lucideUserRoundPlus,
  lucideUsersRound,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { ReactiveFormsModule } from '@angular/forms';
import { ImageCropperComponent } from 'ngx-smart-cropper';
import { toast } from '@spartan-ng/brain/sonner';
import { ConversationI } from '../../interfaces/conversation.interface';
import { ParticipantI } from '../../interfaces/participant.interface';
import { ConversationService } from '../../services/conversation.service';
import { UserService } from '../../../user/services/user.service';
import { ChatboxSettingsService } from '../../services/chatbox-settings.service';
import { ItemManagerComponent } from '../../../../shared/components/item-manager/item-manager';
import { MediaFilesListComponent } from '../media-files-list/media-files-list.component';
import { base64ToFile } from '../../../../shared/functions/base64-to-file';
import { markFormGroupTouched } from '../../../../shared/functions/form.utils';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-chatbox-settings',
  imports: [
    RouterLink,
    NgIcon,
    HlmTabsImports,
    ReactiveFormsModule,
    HlmIcon,
    HlmButton,
    HlmDropdownMenuImports,
    HlmAvatarImports,
    ImageCropperComponent,
    HlmSpinner,
    MediaFilesListComponent,
  ],
  providers: [
    ChatboxSettingsService,
    provideIcons({
      lucideArrowLeft,
      lucideUsersRound,
      lucideCircleUserRound,
      lucideChevronUp,
      lucideChevronDown,
      lucidePencil,
      lucideDoorOpen,
      lucideUserRoundPlus,
      lucideUserRoundMinus,
      lucideEllipsis,
      lucideMessageCircle,
      lucideMenu,
    }),
  ],
  templateUrl: './chatbox-settings.component.html',
  styleUrl: './chatbox-settings.component.css',
})
export class ChatboxSettingsComponent {
  conversation = input<ConversationI>();
  closeSettings = output<void>();

  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private settingsService = inject(ChatboxSettingsService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  currentUser = this.userService.currentUser;
  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: Record<string, boolean> = {
    chatInfo: false,
    members: false,
  };

  modalVcr = viewChild('modalContainer', { read: ViewContainerRef });
  #modalRef?: ComponentRef<ItemManagerComponent>;
  #submitSub?: OutputRefSubscription;

  initialChatImageSrc = signal<string | null>(null);
  readonly uploadingPicture = signal(false);

  toggleDropdown(menu: string): void {
    this.dropdownMenuStates[menu] = !this.dropdownMenuStates[menu];
  }

  isOpen(menu: string): boolean {
    return this.dropdownMenuStates[menu];
  }

  onMessageMember(participant: ParticipantI): void {
    const existingConversation = this.conversationService
      .conversationList()
      ?.conversations.find(
        (c) =>
          !c.is_group && c.participants.some((p) => p._id === participant._id),
      );

    if (existingConversation) {
      this.router.navigate(['/messages', existingConversation._id]);
      return;
    }

    this.conversationService.selectUserForConversation(participant);
    this.conversationService.createMockConversation();
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      toast.error('File size exceeds the 100MB limit.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e: ProgressEvent<FileReader>) =>
      this.initialChatImageSrc.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  onChatImageChange(imageSrc: string): void {
    this.initialChatImageSrc.set(null);

    if (!imageSrc) {
      toast.info('Image selection was cancelled');
      return;
    }

    const conversationId = this.conversation()?._id;
    if (!conversationId) return;

    /*
     * Show the new picture at once.
     *
     * The upload only *starts* a pipeline — presign, PUT, confirm, a queued
     * worker that resizes it, a database write and finally a WebSocket event —
     * so there were several seconds where the user had confirmed a crop and the
     * avatar was still the old one. The optimistic image is replaced by the
     * processed URL the moment the server reports one.
     */
    this.conversationService.setPendingGroupPicture(conversationId, imageSrc);
    this.uploadingPicture.set(true);

    this.settingsService
      .updateChatPicture(
        conversationId,
        base64ToFile(imageSrc, 'chat-image.png'),
      )
      ?.pipe(
        tap(() => {
          this.uploadingPicture.set(false);
          toast.success('Conversation picture changed.');
        }),
        catchError((err) => {
          // The optimistic picture is a promise the upload just broke; leaving
          // it would show a change that never happened.
          this.conversationService.clearPendingGroupPicture(conversationId);
          this.uploadingPicture.set(false);
          toast.error('Failed to update picture', { description: err.message });
          return throwError(() => err);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /** The picture to show: the optimistic one while it is outstanding. */
  chatImageUrl(): string | null {
    const conversation = this.conversation();
    return (
      this.conversationService.pendingGroupPictureFor(conversation?._id) ??
      conversation?.group_picture ??
      null
    );
  }

  onChatNameChange(): void {
    const conversation = this.conversation();
    if (!conversation) return;

    const form = this.settingsService.buildChatNameForm(
      conversation.group_name ?? '',
    );

    this.createModal({
      headerText: 'Modify conversation name',
      description: 'Change the name to keep it organized.',
      variant: 'form',
      actionName: 'update',
      form,
    });

    this.#submitSub = this.#modalRef?.instance.submit.subscribe((formData) => {
      if (!form.valid) {
        markFormGroupTouched(form);
        toast.error('Please correct the form errors.');
        return;
      }

      const newName = formData.groupName?.trim();
      const obs = this.settingsService.updateChatName(
        String(conversation._id),
        newName,
        conversation.group_name ?? '',
      );

      if (!obs) return; // toast already shown for no-change case

      this.#modalRef?.setInput('isSubmitting', true);
      obs
        .pipe(
          tap((res) => {
            this.#modalRef?.setInput('isSubmitting', false);
            toast.success(`Name changed to "${res.group_name}"`);
            this.#modalRef?.instance.closed.emit();
          }),
          catchError((err) => {
            this.#modalRef?.setInput('isSubmitting', false);
            toast.error('Failed to update name', { description: err.message });
            return throwError(() => err);
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe();
    });
  }

  onAddMembers(): void {
    const conversation = this.conversation();
    if (!conversation) return;

    this.createModal({
      headerText: 'Add members',
      description: 'Search and select users to add.',
      variant: 'user-list',
    });

    const users = this.userService.users()?.users;
    let filteredUsers = this.settingsService.getFilteredUsers(conversation);

    if (!users?.length) {
      this.#modalRef?.setInput('isLoading', true);
      this.userService
        .fetchUsers()
        .pipe(
          tap((res) => {
            filteredUsers = res.users.filter(
              (u) => !conversation.participants.some((p) => p._id === u._id),
            );
            this.#modalRef?.setInput('isLoading', false);
            this.#modalRef?.setInput('items', filteredUsers);
          }),
          catchError((err) => {
            this.#modalRef?.setInput('isLoading', false);
            toast.error('Failed to load users');
            return throwError(() => err);
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe();
    } else {
      this.#modalRef?.setInput('items', filteredUsers);
    }

    this.#submitSub = this.#modalRef?.instance.submit.subscribe(
      (ids: string[]) => {
        this.#modalRef?.setInput('isSubmitting', true);
        this.settingsService
          .addMembers(ids, String(conversation._id))
          .pipe(
            tap(() => {
              this.#modalRef?.setInput('isSubmitting', false);
              filteredUsers = filteredUsers.filter((u) => !ids.includes(u._id));
              this.#modalRef?.setInput('items', filteredUsers);
            }),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe();
      },
    );
  }

  onRemoveMember(user: ParticipantI): void {
    const conversationId = String(this.conversation()?._id);

    this.createModal({
      headerText: 'Are you sure?',
      description: `Remove ${user.username} from conversation?`,
      variant: 'confirmation',
      submitVariant: 'destructive',
      actionName: 'remove',
    });

    this.#submitSub = this.#modalRef?.instance.submit.subscribe(() => {
      this.#modalRef?.setInput('isSubmitting', true);

      this.settingsService
        .removeMember(user._id, conversationId)
        .pipe(
          tap(() => {
            this.#modalRef?.setInput('isSubmitting', false);
            this.#modalRef?.instance.closed.emit();
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe();
    });
  }

  onLeaveGroup(): void {
    const currentUser = this.currentUser();
    const conversationId = String(this.conversation()?._id);
    if (!currentUser) return;

    this.createModal({
      headerText: 'Are you sure?',
      description: 'Do you want to leave the conversation?',
      variant: 'confirmation',
      submitVariant: 'destructive',
      actionName: 'leave',
    });

    this.#submitSub = this.#modalRef?.instance.submit.subscribe(() => {
      this.#modalRef?.setInput('isSubmitting', true);
      this.settingsService
        .leaveGroup(currentUser._id, conversationId)
        .pipe(
          tap(() => {
            this.#modalRef?.setInput('isSubmitting', false);
            toast.info(`You left the conversation.`);
            this.#modalRef?.instance.closed.emit();
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe();
    });
  }

  private createModal(config: {
    headerText: string;
    description?: string;
    variant: string;
    submitVariant?: 'default' | 'destructive';
    actionName?: string;
    form?: any;
  }): void {
    // Unsub previous modal's submit before creating new one
    this.#submitSub?.unsubscribe();
    this.modalVcr()?.clear();

    this.#modalRef = this.modalVcr()?.createComponent(ItemManagerComponent);
    this.#modalRef?.setInput('state', 'open');
    this.#modalRef?.setInput('headerText', config.headerText);
    this.#modalRef?.setInput('variant', config.variant);

    if (config.description)
      this.#modalRef?.setInput('description', config.description);
    if (config.submitVariant)
      this.#modalRef?.setInput('submitVariant', config.submitVariant);
    if (config.actionName)
      this.#modalRef?.setInput('actionName', config.actionName);
    if (config.form) this.#modalRef?.setInput('form', config.form);

    const closedSub = this.#modalRef?.instance.closed.subscribe(() => {
      this.#modalRef?.setInput('state', 'closed');

      const animEndSub = this.#modalRef?.instance.animationEnd.subscribe(() => {
        this.#modalRef?.destroy();
        animEndSub?.unsubscribe();
        closedSub?.unsubscribe();
      });
    });
  }
}

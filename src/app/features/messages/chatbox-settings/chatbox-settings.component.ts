import {
  Component,
  ComponentRef,
  inject,
  input,
  OnDestroy,
  OutputRefSubscription,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { ConversationI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import {
  lucideChevronDown,
  lucideChevronUp,
  lucideCircleUserRound,
  lucideDoorOpen,
  lucideMenu,
  lucideMessageCircle,
  lucidePencil,
  lucideUserRoundMinus,
} from '@ng-icons/lucide';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
} from '@spartan-ng/helm/avatar';
import { BrnMenuTriggerDirective } from '@spartan-ng/brain/menu';
import {
  HlmMenuComponent,
  HlmMenuGroupComponent,
  HlmMenuItemDirective,
  HlmMenuItemIconDirective,
  HlmMenuSeparatorComponent,
} from '@spartan-ng/helm/menu';
import { Router, RouterLink } from '@angular/router';
import { ConversationService } from '../services/conversation.service';
import { ParticipantI } from '../interfaces/participant.interface';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { ItemManagerComponent } from '../../../shared/components/item-manager/item-manager.component';
import { Subscription, tap } from 'rxjs';
import { UserService } from '../../user/services/user.service';
import { toast } from 'ngx-sonner';

@Component({
  selector: 'app-chatbox-settings',
  imports: [
    NgIcon,
    RouterLink,
    HlmIconDirective,
    HlmAvatarImageDirective,
    BrnMenuTriggerDirective,
    HlmMenuItemIconDirective,
    HlmMenuItemDirective,
    HlmButtonDirective,
    HlmMenuComponent,
    HlmMenuGroupComponent,
    HlmMenuSeparatorComponent,
    HlmAvatarComponent,
  ],
  providers: [
    provideIcons({
      lucideChevronDown,
      lucideChevronUp,
      lucidePencil,
      lucideDoorOpen,
      lucideMenu,
      lucideMessageCircle,
      lucideCircleUserRound,
      lucideUserRoundMinus,
    }),
  ],
  templateUrl: './chatbox-settings.component.html',
  styleUrl: './chatbox-settings.component.css',
})
export class ChatboxSettingsComponent implements OnDestroy {
  conversation = input<ConversationI>();
  conversationService = inject(ConversationService);
  userService = inject(UserService);
  router = inject(Router);

  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: { [key: string]: boolean } = {
    chatInfo: false,
    members: false,
  };
  openUserMenuIndex: number | null = null;

  modalVcr = viewChild('modalContainer', { read: ViewContainerRef });
  #modalComponentRef?: ComponentRef<ItemManagerComponent>;

  private subscriptions: (Subscription | OutputRefSubscription)[] = [];

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
      this.router.navigate(['/messages', conversationId]);
    } else {
      this.conversationService.selectUserForConversation(participant);
      this.conversationService.createMockConversation();
    }
  }

  onChatNameChange(): void {}

  onAddMembers(): void {
    this.createComponent();

    this.#modalComponentRef?.setInput('headerText', 'Add members');
    this.#modalComponentRef?.setInput(
      'description',
      'Search and select the users you want to add to your conversation.'
    );
    this.#modalComponentRef?.setInput('variant', 'user-list');

    const userList = this.userService.users;

    this.subscriptions.push(
      this.userService
        .fetchUsers()
        .pipe(
          tap((res) => this.#modalComponentRef?.setInput('items', res.users))
        )
        .subscribe()
    );

    const submitSubscription =
      this.#modalComponentRef?.instance.submit.subscribe((res) => {
        toast.info('Members were added successfully!', {
          description: `${this.formatUsernames(
            userList()?.users.filter((user) => res.includes(user._id)) || []
          )} joined the ${this.conversation()?.group_name || 'conversation'}.`,
        });

        submitSubscription && this.subscriptions.push(submitSubscription);
      });
  }

  onRemoveMember(user_id: string): void {}

  onLeaveGroup(): void {}

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

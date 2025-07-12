import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ComponentFactoryResolver,
  ComponentRef,
  inject,
  Injector,
  input,
  OnChanges,
  OnDestroy,
  OutputRefSubscription,
  TemplateRef,
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
import { catchError, Subscription, tap, throwError } from 'rxjs';
import { UserService } from '../../user/services/user.service';
import { toast } from 'ngx-sonner';
import { MemberChangesI } from '../interfaces/member-changes.interface';
import { UserI } from '../../user/interfaces/user.interface';
import { CdkPortal } from '@angular/cdk/portal';
import { PortalRegistryService } from '../../../shared/services/portal-registry.service';
import { NavController } from '@ionic/angular/common';

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
    CdkPortal,
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatboxSettingsComponent implements OnChanges, OnDestroy {
  conversation = input<ConversationI>();
  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private navCtrl = inject(NavController);
  private portalRegistryService = inject(PortalRegistryService);

  readonly apiUrl = environment.apiUrl;

  dropdownMenuStates: { [key: string]: boolean } = {
    chatInfo: false,
    members: false,
  };
  openUserMenuIndex: number | null = null;

  portalContent = viewChild<CdkPortal>(CdkPortal);

  modalVcr = viewChild('modalContainer', { read: ViewContainerRef });
  #modalComponentRef?: ComponentRef<ItemManagerComponent>;

  private subscriptions: (Subscription | OutputRefSubscription)[] = [];

  ngOnChanges(): void {
    const content = this.portalContent();
    if (content) {
      this.portalRegistryService.setPortal(content);
    }
  }

  ngOnDestroy(): void {
    this.portalRegistryService.clearPortal();
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
              this.navCtrl.navigateForward(['/messages', res.conversationId])
            )
          )
          .subscribe()
      );
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

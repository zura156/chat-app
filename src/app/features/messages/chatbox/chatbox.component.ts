import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  QueryList,
  Signal,
  signal,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  of,
  Subject,
  switchMap,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import {
  ConversationI,
  ReadReceiptI,
} from '../interfaces/conversation.interface';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
} from '@spartan-ng/ui-avatar-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import {
  GroupedMessages,
  MessageI,
  MessageStatus,
  MessageType,
} from '../interfaces/message.interface';
import {
  HlmCardDescriptionDirective,
  HlmCardDirective,
} from '@spartan-ng/ui-card-helm';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { WebSocketService } from '../services/web-socket.service';
import { HlmSpinnerComponent } from '@spartan-ng/ui-spinner-helm';
import { UserI } from '../../user/interfaces/user.interface';
import { ParticipantI } from '../interfaces/participant.interface';
import {
  MessageStatusMessage,
  TypingMessage,
  WebSocketMessageT,
} from '../interfaces/web-socket-message.interface';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { MessageCardComponent } from '../message/message-card.component';
import { ToastrService } from 'ngx-toastr';
import { JsonPipe } from '@angular/common';

@Component({
  selector: 'app-chatbox',
  imports: [
    TimeAgoPipe,
    HlmCardDirective,
    HlmInputDirective,
    HlmButtonDirective,
    HlmSeparatorDirective,
    HlmAvatarImageDirective,
    HlmCardDescriptionDirective,
    HlmAvatarComponent,
    HlmSpinnerComponent,
    MessageCardComponent,
    BrnSeparatorComponent,
    ReactiveFormsModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chatbox.component.html',
  styleUrl: './chatbox.component.css',
})
export class ChatboxComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly messageService = inject(MessageService);
  private readonly webSocketService = inject(WebSocketService);
  private readonly toast = inject(ToastrService);

  private readonly destroy$ = new Subject<void>();

  private readonly TIME_GAP_THRESHOLD: number = 15;

  conversation: Signal<ConversationI | null> = signal<ConversationI | null>(
    null
  );

  groupImageUrl = linkedSignal<string | null>(() => {
    const currentConversation = this.conversation();
    if (!currentConversation) {
      return null;
    }

    if (currentConversation.is_group) {
      return currentConversation.group_picture ?? null;
    } else {
      const otherUser = currentConversation.participants.find(
        (participant) => participant._id !== this.currentUser()?._id
      );
      return otherUser?.profile_picture ?? null;
    }
  });

  messages = this.messageService.activeMessages;
  groupedMessages = linkedSignal<GroupedMessages[]>(() => {
    let groupedMessages: GroupedMessages[] = [];
    const messages = this.messages();

    let currentGroup: MessageI[] = [];
    let lastTimestamp: Date | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (lastTimestamp) {
        const timeDifference =
          (lastTimestamp.getTime() - new Date(message.createdAt).getTime()) /
          (1000 * 60); // in minutes

        if (timeDifference >= this.TIME_GAP_THRESHOLD) {
          groupedMessages.push({
            timeframe: this.formatTimestamp(lastTimestamp.toISOString()), // Format the last timestamp of the group
            messages: currentGroup,
          });
          currentGroup = [];
        }
      }

      currentGroup.push(message);
      lastTimestamp = new Date(message.createdAt);
    }

    if (currentGroup.length > 0) {
      groupedMessages.push({
        timeframe: this.formatTimestamp(lastTimestamp?.toISOString() ?? ''), // Format the last timestamp of the group
        messages: currentGroup,
      });
    }
    return groupedMessages;
  });
  totalMessagesCount = signal<number>(0);

  messageControl = new FormControl<string>('');

  currentUser = this.userService.currentUser;
  selectedUser = this.conversationService.selectedUser;

  offset = signal<number>(0);
  limit = 20;
  hasMoreMessages = signal<boolean>(true);

  isLoading = signal<boolean>(false);
  isTyping = signal<{
    typer: Partial<ParticipantI>;
    is_typing: boolean;
    conversationId: string;
  } | null>(null);

  @ViewChild('topTracker') observedElement?: ElementRef;
  @ViewChildren('messageItem') messageItems?: QueryList<ElementRef>;

  isVisible = signal<boolean>(false);
  isVisibilityObserving = signal<boolean>(false);
  private visibleMessageIds = new Set<string>();

  private divTopIntersectionObserver?: IntersectionObserver;
  private messageIntersectionObserver?: IntersectionObserver;

  ngOnInit(): void {
    if (window.visualViewport && window.visualViewport?.height > 1000) {
      this.limit = 40;
    }

    this.trackTypingStatus();

    this.isLoading.set(true);
    this.route.params
      .pipe(
        map((params) => params['id']),
        catchError((err) => this.handleError(err)),
        switchMap((id) => {
          this.conversation = this.conversationService.activeConversation;
          const selectedUser: UserI | null = JSON.parse(
            sessionStorage.getItem('selectedUser') ?? 'null'
          );
          if (selectedUser) {
            this.conversationService.selectUserForConversation(selectedUser);
            if (id === selectedUser?._id) {
              this.conversationService.createMockConversation();
              this.messageService.clearActiveMessages();
              return of(this.conversation()).pipe(
                tap(() => this.isLoading.set(false)),
                switchMap(() => this.handleWebSocketMessages())
              );
            }
          }
          return this.conversationService.getConversationById(id).pipe(
            catchError((err) => this.handleError(err, true)),
            switchMap((c) => {
              if (!c) {
                return EMPTY;
              }

              this.hasMoreMessages.set(true);
              this.offset.set(0);

              return this.loadMessages(c._id).pipe(
                tap((messagesList) => {
                  const user = this.currentUser();
                  this.totalMessagesCount.set(messagesList.totalCount);

                  if (messagesList.messages.length > 0) {
                    const duplicateIds = messagesList.messages.filter(
                      (id, index) => messagesList.messages.indexOf(id) !== index
                    );
                    if (duplicateIds.length > 0) {
                      console.warn('Duplicate _id values found:', duplicateIds);
                    }
                    if (messagesList.totalCount > this.offset()) {
                      this.hasMoreMessages.set(true);
                      this.offset.update((val) => val + this.limit);
                    } else {
                      this.hasMoreMessages.set(false);
                    }

                    const lastMessageId = messagesList.messages.filter(
                      (m) => user?._id !== m.sender._id
                    )[0]?._id;

                    if (lastMessageId) {
                      this.markMessagesAsRead(lastMessageId);
                    }
                  }

                  this.isLoading.set(false);
                }),
                catchError((err) => this.handleError(err)),
                switchMap(() => this.handleWebSocketMessages())
              );
            })
          );
        })
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.divTopIntersectionObserver) {
      this.divTopIntersectionObserver.disconnect();
    }
    if (this.messageIntersectionObserver) {
      this.messageIntersectionObserver.disconnect();
    }
  }

  private handleWebSocketMessages(): Observable<WebSocketMessageT> {
    return (
      this.webSocketService.onMessage()?.pipe(
        tap((res) => {
          switch (res.type) {
            case 'typing':
              this.isTyping.set({
                typer: res.sender ?? {},
                is_typing: !!res.is_typing,
                conversationId: res.conversation,
              });
              break;
            case 'message':
              const user = this.currentUser();
              const message: MessageI = res.message;

              if (res.message.sender === user?._id) {
                this.messageService.fillInMessageDetails(message);

                return;
              }

              const conversation = this.conversation();

              if (conversation && conversation._id === res.message.conversation)
                this.messageService.addMessage(message);
              if (message._id && user?._id !== message.sender._id) {
                this.markMessagesAsRead(message._id);
              }

              return;
            case 'user-status':
              const { userId, status: userStatus } = res;

              let { last_seen } = res;

              if (!last_seen) {
                last_seen = new Date().toISOString();
              }

              this.conversationService.updateParticipantStatus(
                userId,
                userStatus,
                last_seen
              );
              break;
            case 'message-status':
              const { read_receipt, status: messageStatus } = res;

              const {
                last_message_read_id: last_message_id,
                user_id: sender_id,
                read_at,
              } = read_receipt;

              const readReceipt: ReadReceiptI = {
                user_id: sender_id,
                last_message_read_id: last_message_id,
                read_at: new Date(read_at ?? ''),
              };

              this.conversationService.updateReadReceipts(readReceipt);

              this.messageService.updateMessageStatus(
                last_message_id,
                messageStatus as MessageStatus
              );
              break;

            case 'conversation-leave':
              const {
                removed_by,
                removed_user,
                conversation: leftConversation,
              } = res;

              this.conversationService.removeConversationFromList(
                leftConversation as ConversationI
              );
              break;
          }
        }),
        catchError((err) => this.handleError(err))
      ) || EMPTY
    );
  }

  sendMessage(): void {
    const sender = this.userService.currentUser();
    const convo = this.conversation();

    if (!convo || !sender || !this.messageControl.value) return;

    if (!convo.createdAt) {
      this.isLoading.set(true);

      this.conversationService
        .createConversation([sender._id, this.selectedUser()!._id])
        .pipe(
          catchError((err) => this.handleError(err)),
          switchMap((conversation) => {
            this.conversation = this.conversationService.activeConversation;
            const message: MessageI = {
              sender: sender,
              conversation: conversation._id,
              content: this.messageControl.value!,
              type: MessageType.TEXT,
              status: MessageStatus.SENDING,
              createdAt: new Date().toISOString(),
            };

            const participants = conversation.participants.filter(
              (u) => u._id !== sender?._id
            );

            this.router.navigateByUrl(`/messages/${conversation._id}`);

            return this.messageService
              .sendMessage(message, participants, true)
              .pipe(
                catchError((err) => this.handleError(err)),
                tap(() => {
                  this.isLoading.set(false);
                  this.messageControl.reset();
                })
              );
          })
        )
        .subscribe();
    } else {
      this.isLoading.set(true);

      const message: MessageI = {
        sender: sender,
        conversation: convo._id,
        content: this.messageControl.value,
        type: MessageType.TEXT,
        status: MessageStatus.SENDING,
        createdAt: new Date().toISOString(),
      };
      const participants = convo.participants.filter(
        (u) => u._id !== sender?._id
      );

      this.messageService
        .sendMessage(message, participants)
        .pipe(
          catchError((err) => this.handleError(err)),
          tap(() => {
            this.conversation = this.conversationService.activeConversation;
            this.isLoading.set(false);
            this.messageControl.reset();
          })
        )
        .subscribe();
    }
  }

  loadMessages(conversationId: string) {
    if (!this.hasMoreMessages()) return EMPTY;

    this.isLoading.set(true);

    if (!conversationId) return EMPTY;

    return this.messageService
      .getMessagesByConversationId(conversationId, this.offset(), this.limit)
      .pipe(
        debounceTime(500),
        tap((msgs) => {
          this.offset.set(this.offset() + this.limit);
          if (msgs.totalCount > this.offset()) {
            this.hasMoreMessages.set(true);
            this.offset.update((val) => val + this.limit);
          } else {
            this.hasMoreMessages.set(false);
          }
          this.isLoading.set(false);
        })
      );
  }

  private markMessagesAsRead(lastMessageId: string): void {
    if (!lastMessageId) return;

    const message = this.findMessageById(lastMessageId);
    const user = this.currentUser();
    if (!user || !message) return;
    if (user._id === message.sender._id) return;
    if (message.status === MessageStatus.READ) return;

    const currentUserId = user._id;
    const conversation = this.conversation();

    if (
      conversation &&
      conversation.read_receipts.some(
        (r) =>
          r.user_id === currentUserId &&
          r.last_message_read_id === lastMessageId
      )
    )
      return;

    if (!currentUserId || !conversation?._id) return;

    // Then send to server via websocket
    const readData: MessageStatusMessage = {
      type: 'message-status',
      read_receipt: {
        last_message_read_id: lastMessageId,
        user_id: currentUserId,
      },
      conversation_id: conversation._id,
      status: 'read',
    };

    this.webSocketService.sendMessage(readData);
  }

  onChatTopVisible(): void {
    if (this.observedElement && !this.isVisibilityObserving()) {
      this.isVisibilityObserving.set(true);
      this.divTopIntersectionObserver = new IntersectionObserver(
        ([entry]) => {
          this.isVisible.set(entry.isIntersecting && !this.isLoading());
          if (this.hasMoreMessages() && this.isVisible()) {
            this.loadMessages(String(this.conversation()?._id))?.subscribe();
          }
          if (this.totalMessagesCount() < this.offset()) {
            this.divTopIntersectionObserver?.disconnect();
          }
        },
        {
          threshold: 0.1, // 10% of the element must be visible to trigger
        }
      );

      this.divTopIntersectionObserver.observe(
        this.observedElement.nativeElement
      );
    }
  }

  formatTimestamp(isoString: string): string {
    if (!isoString) return '';

    const timestamp = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const messageDate = new Date(
      timestamp.getFullYear(),
      timestamp.getMonth(),
      timestamp.getDate()
    );

    // Format time component
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
    const timeString = timeFormat.format(timestamp);

    // Today's messages
    if (messageDate.getTime() === today.getTime()) {
      return timeString;
    }

    // Yesterday's messages
    if (messageDate.getTime() === yesterday.getTime()) {
      return `Yesterday at ${timeString}`;
    }

    // Older messages
    const dateFormat = new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
    });
    const dateString = dateFormat.format(timestamp);
    return `${dateString} at ${timeString}`;
  }

  private findMessageById(messageId: string): MessageI | undefined {
    for (const group of this.groupedMessages()) {
      const message = group.messages.find((m) => m._id === messageId);
      if (message) {
        return message;
      }
    }
    return undefined;
  }

  private trackTypingStatus(): void {
    this.messageControl.valueChanges
      .pipe(
        distinctUntilChanged((prev, curr) => Boolean(prev) === Boolean(curr)),
        takeUntil(this.destroy$),
        tap((query) => {
          const sender = this.currentUser();
          const convo = this.conversation();

          if (!sender || !convo) return;

          const data: TypingMessage = {
            type: 'typing',
            sender,
            participants: convo.participants,
            is_typing: Boolean(query),
            conversation: convo._id,
          };
          this.webSocketService.sendMessage(data);
        })
      )
      .subscribe();
  }

  private handleError(
    err: any,
    navigation: boolean = false
  ): Observable<never> {
    this.isLoading.set(false);
    this.toast.error('Something went wrong!', err.message);
    if (navigation) {
      this.router.navigate(['/messages']);
    }
    return throwError(() => err);
  }
}

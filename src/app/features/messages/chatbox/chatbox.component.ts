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
} from '@spartan-ng/helm/avatar';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import {
  GroupedMessages,
  MessageI,
  MessageStatus,
  MessageType,
} from '../interfaces/message.interface';
import {
  HlmCardDescriptionDirective,
  HlmCardDirective,
} from '@spartan-ng/helm/card';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HlmButtonDirective } from '@spartan-ng/helm/button';
import { HlmInputDirective } from '@spartan-ng/helm/input';
import { WebSocketService } from '../services/web-socket.service';
import { HlmSpinnerComponent } from '@spartan-ng/helm/spinner';
import { UserI } from '../../user/interfaces/user.interface';
import { ParticipantI } from '../interfaces/participant.interface';
import {
  MessageStatusMessage,
  TypingMessage,
  WebSocketMessageT,
} from '../interfaces/web-socket-message.interface';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { MessageCardComponent } from '../message/message-card.component';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAudioLines,
  lucideCirclePlus,
  lucideInfo,
  lucidePaperclip,
  lucideSend,
} from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { LayoutService } from '../layout/layout.service';
import { NgClass } from '@angular/common';
import { AudioRecorderComponent } from '../../../shared/components/audio-recorder/audio-recorder.component';
import { RecordingResult } from '../../../shared/interfaces/audio-message.interface';
import { ChatboxSettingsComponent } from '../chatbox-settings/chatbox-settings.component';
import { PanGestureDirective } from '../../../shared/directives/pan.directive';

@Component({
  selector: 'app-chatbox',
  imports: [
    TimeAgoPipe,
    NgIcon,
    NgClass,
    HlmIconDirective,
    PanGestureDirective,
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
    AudioRecorderComponent,
    ChatboxSettingsComponent,
  ],
  providers: [
    provideIcons({
      lucideInfo,
      lucideCirclePlus,
      lucideSend,
      lucidePaperclip,
      lucideAudioLines,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chatbox.component.html',
  styleUrl: './chatbox.component.css',
})
export class ChatboxComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly layoutService = inject(LayoutService);
  private readonly userService = inject(UserService);
  private readonly conversationService = inject(ConversationService);
  private readonly messageService = inject(MessageService);
  private readonly webSocketService = inject(WebSocketService);

  messageControl = new FormControl<string>('');

  messagesResource = this.messageService.activeMessagesResource;

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
  totalMessagesCount = linkedSignal<number>(() =>
    this.messageService.totalMessagesCount()
  );

  groupedMessages = linkedSignal<GroupedMessages[]>(() => {
    let groupedMessages: GroupedMessages[] = [];
    const messages = this.messages();

    let currentGroup: MessageI[] = [];
    let lastTimestamp: Date | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (lastTimestamp) {
        const timeDifference =
          (lastTimestamp.getTime() - new Date(message.timestamp).getTime()) /
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
      lastTimestamp = new Date(message.timestamp);
    }

    if (currentGroup.length > 0) {
      groupedMessages.push({
        timeframe: this.formatTimestamp(lastTimestamp?.toISOString() ?? ''), // Format the last timestamp of the group
        messages: currentGroup,
      });
    }
    return groupedMessages;
  });

  currentUser = this.userService.currentUser;
  selectedUser = this.conversationService.selectedUser;

  offset = signal<number>(0);
  limit = this.messageService.messageLimit;
  hasMoreMessages = this.messageService.hasMoreMessages;

  activeView = this.layoutService.activeView;
  isLoading = signal<boolean>(false);
  isTyping = signal<{
    typer: Partial<ParticipantI>;
    is_typing: boolean;
    conversationId: string;
  } | null>(null);
  isVisible = signal<boolean>(false);
  isVisibilityObserving = signal<boolean>(false);
  isRecording = signal<boolean>(false);

  // handling chat settings open state
  private readonly CHAT_PREFERENCE_STORAGE_KEY = 'prefers-chat-settings-open';
  isSettingsOpen = signal<boolean>(
    localStorage.getItem(this.CHAT_PREFERENCE_STORAGE_KEY) === 'true'
  );

  private recordingResult?: RecordingResult;

  @ViewChild('topTracker') observedElement?: ElementRef;
  @ViewChildren('messageItem') messageItems?: QueryList<ElementRef>;

  private divTopIntersectionObserver?: IntersectionObserver;
  private messageIntersectionObserver?: IntersectionObserver;

  @ViewChild('slider') sliderRef?: ElementRef;
  @ViewChild('sliderContainer') sliderContainerRef?: ElementRef;
  sliderTransform = 'translateX(0px)';

  ngOnInit(): void {
    if (window.visualViewport && window.visualViewport?.height > 1000) {
      this.limit.set(40);
    }

    this.trackTypingStatus();

    this.isLoading.set(true);
    this.route.params
      .pipe(
        takeUntil(this.destroy$),
        map((params) => params['id']),
        catchError((err) => this.handleError(err)),
        switchMap((id) => {
          this.conversationService.selectedConversationId.set(id);
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
            switchMap(() => this.handleWebSocketMessages()),
            catchError((err) => this.handleError(err, true)),
            tap(() => this.isLoading.set(false))
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

  startRecording(): void {
    this.isRecording.set(true);
    this.recordingResult = undefined;
  }

  deleteRecording(): void {
    this.isRecording.set(false);
    this.recordingResult = undefined;
  }

  onStopRecording(result: RecordingResult): void {
    this.recordingResult = result;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sender = this.currentUser();

    if (input.files && input.files[0] && sender) {
      const file = input.files[0];
      const conversation = this.conversation();

      if (conversation) {
        const formData = new FormData();
        formData.append('file', file, file.name);
        formData.append('conversationId', conversation._id);
        this.messageService
          .uploadFileMessage(formData)
          .pipe(
            takeUntil(this.destroy$),
            tap((res) => {
              this.messageService.addMessage(res);
            })
          )
          .subscribe();
      }
    }
  }

  sendMessage(): void {
    const sender = this.userService.currentUser();
    const convo = this.conversation();
    if (!convo || !sender) return;

    if (this.recordingResult) {
      const result = this.recordingResult;

      const formData = new FormData();
      formData.append('file', result.blob, 'recording.webm');
      formData.append('duration', result.duration.toString());
      formData.append('senderId', sender._id);
      formData.append('conversationId', convo._id);

      this.messageService
        .uploadFileMessage(formData)
        .pipe(
          takeUntil(this.destroy$),
          tap((res) => {
            this.messageService.addMessage(res);
            this.isRecording.set(false);
            this.recordingResult = undefined;
          })
        )
        .subscribe();
      return;
    }

    const content = this.messageControl.value;

    if (!content || !content.trim()) return;

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
              content,
              type: MessageType.TEXT,
              status: MessageStatus.SENDING,
              timestamp: new Date().toISOString(),
            };

            const participants = conversation.participants.filter(
              (u) => u._id !== sender?._id
            );

            this.router.navigateByUrl(`/messages/${conversation._id}`);

            return this.messageService
              .sendMessage(message, participants, true)
              .pipe(
                takeUntil(this.destroy$),
                debounceTime(500),
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
        content,
        type: MessageType.TEXT,
        status: MessageStatus.SENDING,
        timestamp: new Date().toISOString(),
      };
      const participants = convo.participants.filter(
        (u) => u._id !== sender?._id
      );

      this.messageService
        .sendMessage(message, participants)
        .pipe(
          takeUntil(this.destroy$),
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
    this.messageService.offset.update((val) => val + this.limit());

    if (!conversationId) return EMPTY;

    this.isLoading.set(false);
    return this.messageService.activeMessages();
  }

  onChatTopVisible(): void {
    if (this.observedElement && !this.isVisibilityObserving()) {
      this.isVisibilityObserving.set(true);
      this.divTopIntersectionObserver = new IntersectionObserver(
        ([entry]) => {
          console.log('Top tracker visibility:', entry.isIntersecting);
          this.isVisible.set(
            entry.isIntersecting && !this.messagesResource.isLoading()
          );
          if (this.hasMoreMessages() && this.isVisible()) {
            this.loadMessages(String(this.conversation()?._id));
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

  toggleSettingsView(): void {
    this.isSettingsOpen.update((val) => {
      const newValue = !val;
      localStorage.setItem(this.CHAT_PREFERENCE_STORAGE_KEY, String(newValue));

      return newValue;
    });
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

              if (message._id && user?._id !== message.sender._id) {
                this.markMessagesAsRead(message._id);
              }

              if (res.message.sender._id === user?._id) {
                this.messageService.fillInMessageDetails(message);
                return;
              }

              const conversation = this.conversation();

              if (conversation && conversation._id === res.message.conversation)
                this.messageService.addMessage(message);

              return;
            case 'user-status':
              const { user_id, status: userStatus } = res;

              let { last_seen } = res;

              if (!last_seen) {
                last_seen = new Date().toISOString();
              }

              this.conversationService.updateParticipantStatus(
                user_id,
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
    if (navigation) {
      this.router.navigate(['/messages']);
    }
    return throwError(() => err);
  }

  // This will be added after other important tasks are done.
  ////////////////////////////////////////////////////////////
  onPanStart(event: TouchEvent) {
    // Optionally add visual feedback
  }

  onPanMove(event: TouchEvent) {
    // Optionally implement drag effect with transform
  }
  ////////////////////////////////////////////////////////////

  onPanEnd(event: { deltaX: number; deltaY: number }) {
    const { deltaX } = event;

    if (deltaX < -100 && !this.isSettingsOpen()) {
      this.toggleSettingsView();
    }

    if (deltaX > 100 && this.isSettingsOpen()) {
      this.toggleSettingsView();
    }
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  Signal,
  signal,
  viewChild,
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
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import {
  ConversationI,
  ReadReceiptI,
} from '../../interfaces/conversation.interface';
import {
  HlmAvatarImage,
  HlmAvatar,
  HlmAvatarFallback,
} from '@spartan-ng/helm/avatar';

import { HlmSeparator } from '@spartan-ng/helm/separator';
import {
  GroupedMessages,
  MessageI,
  MessageStatus,
  MessageType,
} from '../../interfaces/message.interface';
import { HlmCard } from '@spartan-ng/helm/card';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { WebSocketService } from '../../services/web-socket.service';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { UserI } from '../../../user/interfaces/user.interface';
import { ParticipantI } from '../../interfaces/participant.interface';
import {
  TypingMessage,
  WebSocketMessageT,
} from '../../interfaces/web-socket-message.interface';
import { TimeAgoPipe } from '../../../../shared/pipes/time-ago.pipe';
import { MessageCardComponent } from '../message/message-card.component';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAudioLines,
  lucideCirclePlus,
  lucideInfo,
  lucideMessageCircle,
  lucideSend,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { LayoutService } from '../../services/layout.service';
import { AudioRecorder } from '../../../../shared/components/audio-recorder/audio-recorder';
import { RecordingResult } from '../../../../shared/interfaces/audio-message.interface';
import { ChatboxSettingsComponent } from '../chatbox-settings/chatbox-settings.component';
import { PanGestureDirective } from '../../../../shared/directives/pan.directive';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { environment } from '../../../../../environments/environment';
import { toast } from '@spartan-ng/brain/sonner';
import { UserStateService } from '../../../user/services/user-state.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-chatbox',
  imports: [
    TimeAgoPipe,
    NgIcon,
    HlmIcon,
    PanGestureDirective,
    HlmCard,
    HlmInput,
    HlmButton,
    HlmSeparator,
    HlmAvatarImage,
    HlmAvatar,
    HlmSpinner,
    MessageCardComponent,
    ReactiveFormsModule,
    AudioRecorder,
    ChatboxSettingsComponent,
    HlmSkeleton,
    HlmAvatarFallback,
  ],
  providers: [
    provideIcons({
      lucideInfo,
      lucideMessageCircle,
      lucideCirclePlus,
      lucideAudioLines,
      lucideSend,
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
  private readonly userStateService = inject(UserStateService);
  private readonly conversationService = inject(ConversationService);
  private readonly messageService = inject(MessageService);
  private readonly webSocketService = inject(WebSocketService);
  private readonly notificationService = inject(NotificationService);

  readonly apiUrl = environment.apiUrl;

  messageControl = new FormControl<string>('');

  messagesResource = this.messageService.activeMessagesResource;

  private readonly destroy$ = new Subject<void>();

  private readonly MESSAGE_TIME_GAP_THRESHOLD: number = 15;

  conversation: Signal<ConversationI | null> = signal<ConversationI | null>(
    null,
  );
  private previousConversationId = this.messageService.previousConversationId;

  groupImageUrl = linkedSignal<string | null>(() => {
    const currentConversation = this.conversation();
    if (!currentConversation) {
      return null;
    }

    if (currentConversation.is_group) {
      return currentConversation.group_picture ?? null;
    } else {
      const otherUser = currentConversation.participants.find(
        (participant) => participant._id !== this.currentUser()?._id,
      );
      return otherUser?.profile_picture ?? null;
    }
  });

  messages = this.messageService.activeMessages;
  totalMessagesCount = linkedSignal<number>(() =>
    this.messageService.totalMessagesCount(),
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

        if (timeDifference >= this.MESSAGE_TIME_GAP_THRESHOLD) {
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

  currentUser = this.userStateService.currentUser;
  selectedUser = this.conversationService.selectedUser;

  messageOffset = this.messageService.messageOffset;
  messageLimit = this.messageService.messageLimit;
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
  canMessage = signal<boolean>(false);

  // handling chat settings open state
  private readonly CHAT_PREFERENCE_STORAGE_KEY = 'prefers-chat-settings-open';
  isSettingsOpen = signal<boolean>(
    localStorage.getItem(this.CHAT_PREFERENCE_STORAGE_KEY) === 'true',
  );

  private recordingResult?: RecordingResult;

  private observedElement? = viewChild<ElementRef>('topTracker');

  private divTopIntersectionObserver?: IntersectionObserver;
  private messageIntersectionObserver?: IntersectionObserver;

  private lastMessageSentAt = 0;
  private readonly MIN_MESSAGE_INTERVAL = 300; // 300 milliseconds

  constructor() {
    effect(() => {
      const currentConversation = this.conversation();
      const currentId = currentConversation?._id;
      const messages = this.messagesResource.value();
      const isLoading = this.messagesResource.isLoading();

      const conversationChanged =
        this.previousConversationId() !== undefined &&
        this.previousConversationId() !== currentId;

      const messagesAvailable = messages && !isLoading;

      if (
        this.previousConversationId() &&
        this.previousConversationId() !== currentId
      ) {
        this.messageService.resetMediaMessagesFetch();
        this.messageService.resetFileMessagesFetch();
      }

      if (
        (conversationChanged || this.previousConversationId() === undefined) &&
        messagesAvailable &&
        currentId
      ) {
        const lastMessage = messages.messages[0];
        if (
          lastMessage?._id &&
          lastMessage?.sender._id !== this.currentUser()?._id
        ) {
          this.markMessageAsRead(lastMessage);
        }
        this.previousConversationId.set(currentId);
      }
    });
  }

  ngOnInit(): void {
    if (window.visualViewport && window.visualViewport?.height > 1000) {
      this.messageLimit.set(40);
    }

    this.trackTypingStatus();

    this.route.params
      .pipe(
        tap(() => this.isLoading.set(true)),
        takeUntil(this.destroy$),
        map((params) => params['id']),
        catchError((err) => this.handleError(err)),
        switchMap((id) => {
          this.conversation = this.conversationService.activeConversation;
          if (this.conversation()?._id !== id) {
            this.messageService.clearActiveMessages();
            this.messageOffset.set(0);
          }
          this.conversationService.selectedConversationId.set(id);
          const selectedUser: UserI | null = JSON.parse(
            sessionStorage.getItem('selectedUser') ?? 'null',
          );
          if (selectedUser) {
            this.conversationService.selectUserForConversation(selectedUser);
            if (id === selectedUser?._id) {
              this.conversationService.createMockConversation();
              return of(this.conversation()).pipe(
                tap(() => {
                  this.isLoading.set(false);
                  this.canMessage.set(true);
                }),
                switchMap(() => this.handleWebSocketMessages()),
              );
            }
          }
          return this.conversationService.getConversationById(id).pipe(
            tap(() => {
              this.isLoading.set(false);
              this.canMessage.set(true);
            }),
            switchMap(() => this.handleWebSocketMessages()),
            catchError((err) => this.handleError(err, true)),
          );
        }),
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

  trackGroupedMessage(index: number, group: GroupedMessages): string {
    return `${group.timeframe}-${group.messages.length}-${
      group.messages[0]?._id || index
    }`;
  }

  trackMessage(index: number, message: MessageI): string {
    return (
      message._id ||
      `${message.timestamp}-${message.sender._id}-${index}` ||
      `temp-${index}-${Date.now()}`
    );
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
            }),
          )
          .subscribe();
      }
    }
  }

  sendMessage(): void {
    const sender = this.currentUser();
    const convo = this.conversation();
    const content = this.messageControl.value;
    const canMessage = this.canMessage();
    const now = Date.now();

    if (content && content.length > 2000) {
      toast.error('Message is too long. Maximum length is 2000 characters.');
      return;
    }
    if (
      !convo ||
      !sender ||
      (content && this.isMash(content)) ||
      !canMessage ||
      now - this.lastMessageSentAt < this.MIN_MESSAGE_INTERVAL
    )
      return;

    if (this.recordingResult) {
      const result = this.recordingResult;

      const formData = new FormData();
      formData.append('file', result.blob, 'recording.webm');
      formData.append('duration', result.duration.toString());
      formData.append('senderId', sender._id);
      formData.append('conversationId', convo._id);

      this.canMessage.set(false);

      this.messageService
        .uploadFileMessage(formData)
        .pipe(
          takeUntil(this.destroy$),
          debounceTime(500),
          tap((res) => {
            this.messageService.addMessage(res);
            this.isRecording.set(false);
            this.recordingResult = undefined;
            this.canMessage.set(true);
            this.lastMessageSentAt = Date.now();
          }),
        )
        .subscribe();
      return;
    }

    if (!content || !content.trim()) return;

    if (!convo.createdAt) {
      this.isLoading.set(true);

      this.conversationService
        .createConversation([sender._id, this.selectedUser()!._id])
        .pipe(
          catchError((err) => this.handleError(err)),
          switchMap((conversation) => {
            this.canMessage.set(false);

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
              (u) => u._id !== sender?._id,
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
                  this.canMessage.set(true);
                  this.lastMessageSentAt = Date.now();
                  this.messageControl.reset();
                }),
              );
          }),
        )
        .subscribe();
    } else {
      this.isLoading.set(true);
      this.canMessage.set(false);

      const message: MessageI = {
        sender: sender,
        conversation: convo._id,
        content,
        type: MessageType.TEXT,
        status: MessageStatus.SENDING,
        timestamp: new Date().toISOString(),
      };
      const participants = convo.participants.filter(
        (u) => u._id !== sender?._id,
      );

      this.messageService
        .sendMessage(message, participants)
        .pipe(
          takeUntil(this.destroy$),
          debounceTime(500),
          catchError((err) => this.handleError(err)),
          tap(() => {
            this.conversation = this.conversationService.activeConversation;
            this.isLoading.set(false);
            this.canMessage.set(true);
            this.lastMessageSentAt = Date.now();
            this.messageControl.reset();
          }),
        )
        .subscribe();
    }
  }

  loadMessages(conversationId: string, isMockConversation: boolean = false) {
    if (!this.hasMoreMessages()) return [];
    this.messageService.messageOffset.update(
      (val) => val + this.messageLimit(),
    );

    if (!conversationId) return [];

    this.isLoading.set(false);

    if (isMockConversation) {
      return [];
    }
    return this.messageService.activeMessages();
  }

  onChatTopVisible(): void {
    if (!this.observedElement) {
      return;
    }

    if (this.observedElement() && !this.isVisibilityObserving()) {
      this.isVisibilityObserving.set(true);
      this.divTopIntersectionObserver = new IntersectionObserver(
        ([entry]) => {
          this.isVisible.set(
            entry.isIntersecting && !this.messagesResource.isLoading(),
          );
          if (this.hasMoreMessages() && this.isVisible()) {
            this.loadMessages(
              String(this.conversation()?._id),
              String(this.conversation()?._id) === this.selectedUser()?._id,
            );
            this.isVisibilityObserving.set(false);
          }
          if (this.totalMessagesCount() < this.messageOffset()) {
            this.divTopIntersectionObserver?.disconnect();
          }
        },
        {
          threshold: 0.01,
        },
      );

      this.divTopIntersectionObserver.observe(
        this.observedElement()?.nativeElement,
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
      timestamp.getDate(),
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
      this.webSocketService.onMessage().pipe(
        tap((res) => {
          const user = this.currentUser();
          switch (res.type) {
            case 'typing':
              this.isTyping.set({
                typer: res.sender ?? {},
                is_typing: !!res.is_typing,
                conversationId: res.conversation_id,
              });
              break;
            case 'message':
              const message: MessageI = res.message;
              const conversation = this.conversation();

              if (!conversation) {
                return;
              }

              const isCurrentUser = message.sender._id === user?._id;
              const isInfoMessage = message.type === 'info';
              const isCurrentConversation =
                conversation._id === message.conversation;

              if (!isInfoMessage && isCurrentUser) {
                this.messageService.fillInMessageDetails(message);
                this.markMessageAsRead(message);
                return;
              }

              if (isCurrentConversation) {
                this.messageService.addMessage(message);
              }

              this.markMessageAsRead(message);
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
                last_seen,
              );
              break;
            case 'message-status':
              const { read_receipt, status: messageStatus } = res;

              if (
                this.conversation() &&
                this.conversation()?._id !== res.conversation_id
              ) {
                return;
              }

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
                messageStatus as MessageStatus,
              );
              break;

            case 'conversation-update':
              const updatedConversation = res.conversation as ConversationI;
              this.conversationService.updateConversationState(
                updatedConversation,
              );

              break;
            case 'conversation-join':
              const {
                conversation: joinedConversation,
                added_users,
                added_by,
              } = res;
              this.conversationService.addConversationToList(
                joinedConversation as ConversationI,
              );
              const addedUsernames = joinedConversation.participants
                ?.filter((participant) =>
                  added_users?.includes(participant._id),
                )
                .map((participant) => participant.username);

              toast.info(
                `Users added to ${
                  joinedConversation.group_name ?? 'conversation'
                }`,
                {
                  description: `${addedUsernames?.join(', ')} ${
                    addedUsernames && addedUsernames.length > 1 ? 'were' : 'was'
                  } added by ${added_by.username}.`,
                },
              );
              break;
            case 'conversation-leave':
              const {
                removed_by,
                removed_users,
                conversation: leftConversation,
              } = res;

              this.conversationService.removeConversationFromList(
                leftConversation as ConversationI,
              );

              const removedUsernames = leftConversation.participants
                ?.filter((participant) =>
                  removed_users.includes(participant._id),
                )
                .map((participant) => participant.username);
              if (user && removed_users.includes(user._id)) {
                removedUsernames?.push('You');
              }

              toast.info(`Users removed from conversation`, {
                description: `${removedUsernames?.join(', ')} were removed by ${
                  removed_by.username
                }.`,
              });
              break;
            case 'notification':
              this.notificationService.handleRealtimeNotification(res);
              break;
          }
        }),
        catchError((err) => this.handleError(err)),
      ) || EMPTY
    );
  }

  private markMessageAsRead(message: MessageI): void {
    const user = this.currentUser();
    const conversation = this.conversation();
    if (!user || !conversation) return;

    if (message._id && message.sender._id !== this.currentUser()?._id) {
      this.notificationService.markAsSeen(
        (message.conversation as ConversationI)?._id ||
          message.conversation.toString(),
      );
      this.messageService.markMessageAsRead(message._id);
      return;
    }
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
            conversation_id: convo._id,
          };
          this.webSocketService.sendMessage(data);
        }),
      )
      .subscribe();
  }

  private handleError(
    err: any,
    navigation: boolean = false,
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
      return;
    }

    if (deltaX > 100 && this.isSettingsOpen()) {
      this.toggleSettingsView();
      return;
    }

    if (deltaX > 100 && !this.isSettingsOpen()) {
      this.router.navigateByUrl('/messages');
      return;
    }
  }

  private isMash(text: string): boolean {
    // 1. Simple repetitive character check (e.g., "aaaaaaaa")
    const repetitive = /(.)\1{5,}/.test(text);

    // 2. High-speed "gibberish" check: No spaces in a long string
    const noSpaces = text.length > 20 && !text.includes(' ');

    return repetitive || noSpaces;
  }
}

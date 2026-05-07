import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  signal,
  viewChild,
  HostListener,
} from '@angular/core';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ConversationService } from '../../services/conversation.service';
import { MessageService } from '../../services/message.service';
import { ConversationI } from '../../interfaces/conversation.interface';
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
import { TypingMessage } from '../../interfaces/web-socket-message.interface';
import { TimeAgoPipe } from '../../../../shared/pipes/time-ago.pipe';
import { MessageCardComponent } from '../message/message-card.component';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCirclePlus,
  lucideInfo,
  lucideMessageCircle,
  lucideMic,
  lucidePaperclip,
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
      lucideMic,
      lucideSend,
      lucidePaperclip,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chatbox.component.html',
  styleUrl: './chatbox.component.css',
})
export class ChatboxComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly layoutService = inject(LayoutService);
  private readonly userStateService = inject(UserStateService);
  private readonly conversationService = inject(ConversationService);
  private readonly messageService = inject(MessageService);
  private readonly webSocketService = inject(WebSocketService);
  // private readonly notificationService = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly apiUrl = environment.apiUrl;

  messageControl = new FormControl<string>('');
  messagesResource = this.messageService.activeMessagesResource;
  private readonly previousConversationId =
    this.messageService.previousConversationId;
  private readonly MESSAGE_TIME_GAP_THRESHOLD = 15;
  private readonly MIN_MESSAGE_INTERVAL = 300;
  private readonly CHAT_PREFERENCE_STORAGE_KEY = 'prefers-chat-settings-open';

  private lastMessageSentAt = 0;
  private recordingResult?: RecordingResult;
  private observedElement? = viewChild<ElementRef>('topTracker');
  private divTopIntersectionObserver?: IntersectionObserver;
  private messageIntersectionObserver?: IntersectionObserver;

  // ── Signals ────────────────────────────────────────────────────────────────

  conversation = this.conversationService.activeConversation;
  currentUser = this.userStateService.currentUser;
  selectedUser = this.conversationService.selectedUser;
  activeView = this.layoutService.activeView;

  messageOffset = this.messageService.messageOffset;
  messageLimit = this.messageService.messageLimit;
  hasMoreMessages = this.messageService.hasMoreMessages;
  messages = this.messageService.activeMessages;
  totalMessagesCount = linkedSignal<number>(() =>
    this.messageService.totalMessagesCount(),
  );

  isLoading = signal(false);
  isVisible = signal(false);
  isVisibilityObserving = signal(false);
  isRecording = signal(false);
  canMessage = signal(false);
  isSettingsOpen = signal(
    localStorage.getItem(this.CHAT_PREFERENCE_STORAGE_KEY) === 'true',
  );

  // ── WS messages as Signals (toSignal auto-unsubscribes on destroy) ──────────

  private readonly typingMessage = this.webSocketService.typingMessage;

  // Typing state derived directly from signal — no effect needed
  isTyping = computed<{
    typer: Partial<ParticipantI>;
    is_typing: boolean;
    conversationId: string;
  } | null>(() => {
    const msg = this.typingMessage();
    if (!msg) return null;
    return {
      typer: msg.sender ?? {},
      is_typing: !!msg.is_typing,
      conversationId: msg.conversation_id,
    };
  });

  // ── Derived signals ─────────────────────────────────────────────────────────

  groupImageUrl = linkedSignal<string | null>(() => {
    const convo = this.conversation();
    if (!convo) return null;
    if (convo.is_group) return convo.group_picture ?? null;
    return (
      convo.participants.find((p) => p._id !== this.currentUser()?._id)
        ?.profile_picture ?? null
    );
  });

  groupedMessages = linkedSignal<GroupedMessages[]>(() => {
    const result: GroupedMessages[] = [];
    const messages = this.messages();
    let currentGroup: MessageI[] = [];
    let lastTimestamp: Date | null = null;

    for (const message of messages) {
      if (lastTimestamp) {
        const diff =
          (lastTimestamp.getTime() - new Date(message.timestamp).getTime()) /
          60000;
        if (diff >= this.MESSAGE_TIME_GAP_THRESHOLD) {
          result.push({
            timeframe: this.formatTimestamp(lastTimestamp.toISOString()),
            messages: currentGroup,
          });
          currentGroup = [];
        }
      }
      currentGroup.push(message);
      lastTimestamp = new Date(message.timestamp);
    }

    if (currentGroup.length > 0) {
      result.push({
        timeframe: this.formatTimestamp(lastTimestamp?.toISOString() ?? ''),
        messages: currentGroup,
      });
    }
    return result;
  });

  // ── Constructor: effects for imperative/non-signal APIs only ────────────────

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.divTopIntersectionObserver?.disconnect();
      this.messageIntersectionObserver?.disconnect();
    });

    // Read receipt on conversation change
    effect(() => {
      const currentId = this.conversation()?._id;
      const messages = this.messagesResource.value();
      const isLoading = this.messagesResource.isLoading();
      const prevId = this.previousConversationId();

      const conversationChanged = prevId !== undefined && prevId !== currentId;
      const messagesAvailable = messages && !isLoading;

      if (prevId && prevId !== currentId) {
        this.messageService.resetMediaMessagesFetch();
        this.messageService.resetFileMessagesFetch();
      }

      if (
        (conversationChanged || prevId === undefined) &&
        messagesAvailable &&
        currentId
      ) {
        const lastMessage = messages.messages[0];
        if (
          lastMessage?._id &&
          lastMessage.sender._id !== this.currentUser()?._id
        ) {
          this.markMessageAsRead(lastMessage);
        }
        this.previousConversationId.set(currentId);
      }
    });

    // user-status: imperative service call → effect is appropriate here
    effect(() => {
      const msg = this.webSocketService.userStatusMessage();
      if (!msg) return;
      this.conversationService.updateParticipantStatus(
        msg.user_id,
        msg.status,
        msg.last_seen ?? new Date().toISOString(),
      );
    });

    // message-status: imperative service calls → effect appropriate
    effect(() => {
      const msg = this.webSocketService.messageStatusMessage();
      if (!msg) return;
      if (this.conversation()?._id !== msg.conversation_id) return;

      const existing = this.conversation()?.read_receipts.find(
        (r) => r.user_id === msg.read_receipt.user_id,
      );
      if (
        existing?.last_message_read_id === msg.read_receipt.last_message_read_id
      )
        return;

      const { last_message_read_id, user_id, read_at } = msg.read_receipt;
      this.conversationService.updateReadReceipts({
        user_id,
        last_message_read_id,
        read_at: new Date(read_at ?? ''),
      });
      this.messageService.updateMessageStatus(
        last_message_read_id,
        msg.status as MessageStatus,
      );
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  ngOnInit(): void {
    if (window.visualViewport && window.visualViewport.height > 1000) {
      this.messageLimit.set(40);
    }

    this.trackTypingStatus();

    // Route-driven WS message stream — Observable because it needs switchMap + side effects
    this.route.params
      .pipe(
        tap(() => this.isLoading.set(true)),
        takeUntilDestroyed(this.destroyRef),
        map((params) => params['id']),
        catchError((err) => this.handleError(err)),
        switchMap((id) => {
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
            if (id === selectedUser._id) {
              this.conversationService.createMockConversation();
              return of(this.conversation()).pipe(
                tap(() => {
                  this.isLoading.set(false);
                  this.canMessage.set(true);
                }),
                switchMap(() => this.handleEventMessages()),
              );
            }
          }

          return this.conversationService.getConversationById(id).pipe(
            tap(() => {
              this.isLoading.set(false);
              this.canMessage.set(true);
            }),
            switchMap(() => this.handleEventMessages()),
            catchError((err) => this.handleError(err, true)),
          );
        }),
      )
      .subscribe();
  }

  // ── Track functions ─────────────────────────────────────────────────────────

  trackGroupedMessage(index: number, group: GroupedMessages): string {
    return `${group.timeframe}-${group.messages.length}-${group.messages[0]?._id || index}`;
  }

  trackMessage(index: number, message: MessageI): string {
    return (
      message._id ||
      `${message.timestamp}-${message.sender._id}-${index}` ||
      `temp-${index}`
    );
  }

  // ── Recording ───────────────────────────────────────────────────────────────

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

  // ── File / message sending ──────────────────────────────────────────────────

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);

    if (!files.length) return;

    event.preventDefault();

    // TODO: handle clipboard files
    // ...
  }

  sendMessage(): void {
    const content = this.messageControl.value;

    if (content && content.length > 2000) {
      toast.error('Message is too long. Maximum length is 2000 characters.');
      return;
    }

    const sender = this.currentUser();
    const convo = this.conversation();
    const now = Date.now();

    if (
      !convo ||
      !sender ||
      !this.canMessage() ||
      now - this.lastMessageSentAt < this.MIN_MESSAGE_INTERVAL
    )
      return;

    if (this.recordingResult) {
      const formData = new FormData();
      formData.append('file', this.recordingResult.blob, 'recording.webm');
      formData.append('duration', this.recordingResult.duration.toString());
      formData.append('senderId', sender._id);
      formData.append('conversationId', convo._id);
      this.canMessage.set(false);

      this.messageService
        .uploadFileMessage(formData)
        .pipe(
          takeUntilDestroyed(this.destroyRef),
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

    if (!content?.trim()) return;

    if (!convo.createdAt) {
      this.isLoading.set(true);
      this.conversationService
        .createConversation([sender._id, this.selectedUser()!._id])
        .pipe(
          catchError((err) => this.handleError(err)),
          switchMap((conversation) => {
            this.canMessage.set(false);
            const tempId = crypto.randomUUID();
            const message: MessageI = {
              sender,
              conversation: conversation._id,
              tempId,
              content,
              type: MessageType.TEXT,
              status: MessageStatus.SENDING,
              timestamp: new Date().toISOString(),
            };
            this.router.navigateByUrl(`/messages/${conversation._id}`);
            return this.messageService
              .sendMessage(
                message,
                conversation.participants.filter((u) => u._id !== sender._id),
                true,
              )
              .pipe(
                takeUntilDestroyed(this.destroyRef),
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
        sender,
        conversation: convo._id,
        content,
        tempId: crypto.randomUUID(),
        type: MessageType.TEXT,
        status: MessageStatus.SENDING,
        timestamp: new Date().toISOString(),
      };
      this.messageService
        .sendMessage(
          message,
          convo.participants.filter((u) => u._id !== sender._id),
        )
        .pipe(
          takeUntilDestroyed(this.destroyRef),
          debounceTime(500),
          catchError((err) => this.handleError(err)),
          tap(() => {
            this.isLoading.set(false);
            this.canMessage.set(true);
            this.lastMessageSentAt = Date.now();
            this.messageControl.reset();
          }),
        )
        .subscribe();
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  loadMessages(conversationId: string, isMockConversation = false) {
    if (!this.hasMoreMessages() || !conversationId || isMockConversation)
      return [];
    this.messageService.messageOffset.update(
      (val) => val + this.messageLimit(),
    );
    this.isLoading.set(false);
    return this.messageService.activeMessages();
  }

  onChatTopVisible(): void {
    if (!this.observedElement?.() || this.isVisibilityObserving()) return;

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
      { threshold: 0.01 },
    );

    this.divTopIntersectionObserver.observe(
      this.observedElement()!.nativeElement,
    );
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────

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
    const timeString = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    }).format(timestamp);
    if (messageDate.getTime() === today.getTime()) return timeString;
    if (messageDate.getTime() === yesterday.getTime())
      return `Yesterday at ${timeString}`;
    return `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(timestamp)} at ${timeString}`;
  }

  toggleSettingsView(): void {
    this.isSettingsOpen.update((val) => {
      localStorage.setItem(this.CHAT_PREFERENCE_STORAGE_KEY, String(!val));
      return !val;
    });
  }

  onPanStart(_event: TouchEvent) {}
  onPanMove(_event: TouchEvent) {}

  onPanEnd({ deltaX }: { deltaX: number; deltaY: number }): void {
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
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  // Only Observable-appropriate cases: message, conversation-*, notification
  // typing/user-status/message-status handled via signals+effects above
  private handleEventMessages() {
    return this.webSocketService.onMessage().pipe(
      tap((res) => {
        const user = this.currentUser();
        switch (res.type) {
          case 'message': {
            const message: MessageI = res.message;
            const conversation = this.conversation();
            if (!conversation) return;
            const isCurrentUser = message.sender._id === user?._id;
            const isCurrentConversation =
              conversation._id === message.conversation;
            if (!isCurrentUser || message.type === 'info') {
              if (isCurrentConversation)
                this.messageService.addMessage(message);
              this.markMessageAsRead(message);
              return;
            }
            if (message.tempId) {
              this.messageService.fillInMessageDetails(message);
            } else if (isCurrentConversation) {
              this.messageService.addMessage(message);
            }
            this.markMessageAsRead(message);
            break;
          }
          case 'conversation-update':
            this.conversationService.updateConversationState(
              res.conversation as ConversationI,
            );
            break;
          case 'conversation-join': {
            const { conversation: joined } = res;
            this.conversationService.addConversationToList(
              joined as ConversationI,
            );

            break;
          }
          case 'conversation-leave': {
            const { conversation: left } = res;
            this.conversationService.removeConversationFromList(
              left as ConversationI,
            );
            break;
          }
          // case 'notification':
          //   this.notificationService.handleRealtimeNotification(res);
          //   break;
        }
      }),
      catchError((err) => this.handleError(err)),
    );
  }

  private markMessageAsRead(message: MessageI): void {
    if (
      !message._id
      // || message.sender._id === this.currentUser()?._id // * Responsible for not marking mark own messages as read
    )
      return;

    this.messageService.markMessageAsRead(message._id);
  }

  private trackTypingStatus(): void {
    this.messageControl.valueChanges
      .pipe(
        distinctUntilChanged((prev, curr) => Boolean(prev) === Boolean(curr)),
        takeUntilDestroyed(this.destroyRef),
        tap((query) => {
          const sender = this.currentUser();
          const convo = this.conversation();
          if (!sender || !convo) return;
          this.webSocketService.sendMessage({
            type: 'typing',
            sender,
            participants: convo.participants,
            is_typing: Boolean(query),
            conversation_id: convo._id,
          } satisfies TypingMessage);
        }),
      )
      .subscribe();
  }

  private handleError(err: any, navigation = false): Observable<never> {
    this.isLoading.set(false);
    if (navigation) this.router.navigate(['/messages']);
    return throwError(() => err);
  }
}

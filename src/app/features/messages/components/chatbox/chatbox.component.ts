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
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
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
  AttachmentI,
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
import { FileVisualPipe } from '../../../../shared/pipes/file-visual.pipe';
import { MessageCardComponent } from '../message/message-card.component';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideAlertCircle,
  lucideCirclePlay,
  lucideCirclePlus,
  lucideFile,
  lucideFileArchive,
  lucideFileSpreadsheet,
  lucideFileText,
  lucideFileType,
  lucideInfo,
  lucideMessageCircle,
  lucideMic,
  lucidePaperclip,
  lucideSend,
  lucideX,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { LayoutService } from '../../services/layout.service';
import { NotificationService } from '../../services/notification.service';
import { AudioRecorder } from '../../../../shared/components/audio-recorder/audio-recorder';
import { RecordingResult } from '../../../../shared/interfaces/audio-message.interface';
import { ChatboxSettingsComponent } from '../chatbox-settings/chatbox-settings.component';
import { MessageActionsComponent } from '../message-actions/message-actions.component';
import { PanGestureDirective } from '../../../../shared/directives/pan.directive';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { environment } from '../../../../../environments/environment';
import { toast } from '@spartan-ng/brain/sonner';
import { UserStateService } from '../../../user/services/user-state.service';
import { UploadService } from '../../../upload/services/upload.service';
import {
  FilePicker,
  FilePickerConfig,
  FileReadyEvent,
  FileSelectedEvent,
} from '../../../upload/file-picker/file-picker';
import { PendingAttachment } from '../../../upload/interfaces/pending-attachment.interface';
import { UploadContext } from '../../../upload/interfaces/upload.interface';
import {
  MediaItem,
  MediaViewerService,
} from '../../../../shared/services/media-viewer.service';

/**
 * The type the server will give this message, worked out up front.
 *
 * Mirrors `MessageService.createMessage`, which classifies by the *first*
 * attachment's context. Guessing differently here would make the optimistic
 * bubble render as one kind of message and then switch to another the moment
 * the server replied.
 */
const optimisticMessageType = (
  recording: File | null,
  attachments: AttachmentI[],
): MessageType => {
  if (recording) return MessageType.AUDIO;
  if (!attachments.length) return MessageType.TEXT;

  switch (attachments[0].context) {
    case 'dm-image':
      return MessageType.IMAGE;
    case 'dm-video':
      return MessageType.VIDEO;
    case 'dm-audio':
      return MessageType.AUDIO;
    default:
      return MessageType.FILE;
  }
};

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const audioExtension = (mimeType: string): string =>
  AUDIO_EXTENSIONS[mimeType] ?? 'webm';

/** The user a not-yet-created conversation is being started with, if any. */
const readSelectedUser = (): UserI | null => {
  try {
    const raw = sessionStorage.getItem('selectedUser');
    return raw ? (JSON.parse(raw) as UserI) : null;
  } catch {
    sessionStorage.removeItem('selectedUser');
    return null;
  }
};

@Component({
  selector: 'app-chatbox',
  imports: [
    TimeAgoPipe,
    FileVisualPipe,
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
    MessageActionsComponent,
    FilePicker,
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
      lucideX,
      lucideAlertCircle,
      lucideCirclePlay,
      lucideFile,
      lucideFileArchive,
      lucideFileSpreadsheet,
      lucideFileText,
      lucideFileType,
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
  private readonly uploadService = inject(UploadService);
  private readonly userStateService = inject(UserStateService);
  private readonly conversationService = inject(ConversationService);
  private readonly messageService = inject(MessageService);
  private readonly webSocketService = inject(WebSocketService);
  private readonly mediaViewerService = inject(MediaViewerService); // will take this into another component eventually, just want to get it working first
  private readonly notificationService = inject(NotificationService);
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
  readonly recordingResult = signal<RecordingResult | undefined>(undefined);
  private observedElement? = viewChild<ElementRef>('topTracker');
  private divTopIntersectionObserver?: IntersectionObserver;
  private messageIntersectionObserver?: IntersectionObserver;

  private readonly filePicker = viewChild.required<FilePicker>('filePicker');
  readonly filePickerConfig: FilePickerConfig = {
    context: 'dm-image', // by default (most common)
    allowedMimeTypes: [], // skips validation
    acceptAttr: '*/*',
  };

  private readonly sendInput =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('sendInput');

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

  isConversationLoading = signal(false);
  isMessageLoading = signal(false);
  isVisible = signal(false);
  isVisibilityObserving = signal(false);
  isRecording = signal(false);
  canMessage = signal(false);
  isSettingsOpen = signal(
    localStorage.getItem(this.CHAT_PREFERENCE_STORAGE_KEY) === 'true',
  );
  isUploading = this.uploadService.isUploading;
  overallProgress = this.uploadService.overallProgress;

  pendingAttachments = signal<PendingAttachment[]>([]);

  // * The textarea's value as a signal.
  private readonly draft = toSignal(
    this.messageControl.valueChanges.pipe(startWith(this.messageControl.value)),
    { initialValue: this.messageControl.value },
  );

  hasSendableContent = computed(
    () =>
      !!this.draft()?.trim() ||
      this.pendingAttachments().some((a) => !a.uploading),
  );

  // Context resolver:
  readonly fileContextResolver = (file: File): UploadContext => {
    if (file.type.startsWith('image/')) return 'dm-image';
    if (file.type.startsWith('video/')) return 'dm-video';
    if (file.type.startsWith('audio/')) return 'dm-audio';
    return 'dm-file';
  };

  // ── WS messages as Signals (toSignal auto-unsubscribes on destroy) ──────────

  private readonly typingMessage = this.webSocketService.typingMessage;

  // Typing state derived directly from signal — no effect needed
  isTyping = computed<{
    sender: Partial<ParticipantI>;
    is_typing: boolean;
    conversationId: string;
  } | null>(() => {
    const msg = this.typingMessage();
    if (!msg) return null;
    return {
      sender: msg.sender ?? {},
      is_typing: !!msg.is_typing,
      conversationId: msg.conversation_id,
    };
  });

  // ── Derived signals ─────────────────────────────────────────────────────────

  groupImageUrl = computed<string | null>(() => {
    const activeConversation = this.conversation();
    if (!activeConversation) return null;
    if (activeConversation.is_group)
      // The optimistic picture wins while an upload is outstanding, so the
      // header changes at the same moment the settings avatar does rather than
      // several seconds later when the worker finishes.
      return (
        this.conversationService.pendingGroupPictureFor(activeConversation._id) ??
        activeConversation.group_picture ??
        null
      );
    return (
      activeConversation.participants.find(
        (p) => p._id !== this.currentUser()?._id,
      )?.pfp_url ?? null
    );
  });

  groupedMessages = computed<GroupedMessages[]>(() => {
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

      const conversationChanged = prevId !== currentId;
      const messagesAvailable = messages && !isLoading;

      if (prevId && prevId !== currentId) {
        this.messageService.resetMediaMessagesFetch();
        this.messageService.resetFileMessagesFetch();
      }

      if (conversationChanged && messagesAvailable && currentId) {
        const lastMessage = messages.messages[0];
        if (
          lastMessage?._id &&
          lastMessage.sender._id !== this.currentUser()?._id
        ) {
          this.markMessageAsRead(lastMessage);
        }
        this.notificationService.markSeen(currentId);
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

    // Messages sent while the socket was down never arrived — refetch the
    // newest page on reconnect; the merge dedupes what we already have.
    this.webSocketService
      .onReconnect()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.conversation()?._id) this.messagesResource.reload();
      });

    // Route-driven WS message stream — Observable because it needs switchMap + side effects
    this.route.params
      .pipe(
        tap(() => this.isConversationLoading.set(true)),
        takeUntilDestroyed(this.destroyRef),
        map((params) => params['id']),
        catchError((err) => this.handleError(err)),
        switchMap((id) => {
          if (this.conversation()?._id !== id) {
            this.messageService.clearActiveMessages();
            this.messageOffset.set(0);
            this.clearPendingAttachments();
          }

          this.conversationService.selectedConversationId.set(id);

          // Corrupt or hand-edited storage should not take the route down with
          // it — an unparseable value simply means "no pre-selected user".
          const selectedUser = readSelectedUser();

          if (selectedUser) {
            if (selectedUser._id !== id) {
              sessionStorage.removeItem('selectedUser');
              toast.error('That conversation could not be opened.');
              return EMPTY;
            }
            this.conversationService.selectUserForConversation(selectedUser);
            if (id === selectedUser._id) {
              this.conversationService.createMockConversation();
              return of(this.conversation()).pipe(
                tap(() => {
                  this.isConversationLoading.set(false);
                  this.canMessage.set(true);
                }),
                switchMap(() => this.handleEventMessages()),
              );
            }
          }

          return this.conversationService.getConversationById(id).pipe(
            tap(() => {
              this.isConversationLoading.set(false);
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

  /**
   * `tempId` is the identity of an optimistic message; `_id` is the identity of
   * a persisted one, and the same message has both once the server answers.
   *
   * The previous key fell back to `timestamp-sender-index`, which changed the
   * moment the real `_id` arrived — so Angular destroyed and recreated the DOM
   * node for every message the user sent, instead of updating it in place. (The
   * `temp-${index}` third branch was also unreachable: the template literal
   * before it is always a non-empty string.)
   */
  trackMessage(index: number, message: MessageI): string {
    return message._id ?? message.tempId ?? `index-${index}`;
  }

  // ── Recording ───────────────────────────────────────────────────────────────

  startRecording(): void {
    this.isRecording.set(true);
    this.recordingResult.set(undefined);
  }
  deleteRecording(): void {
    this.isRecording.set(false);
    this.recordingResult.set(undefined);
    // Dismissing the failed recorder is also how the user retries: the reason
    // may have been fixed in the meantime (permission granted, device plugged
    // in), and refusing to try again would be wrong.
    this.micUnavailable.set(false);
  }
  onStopRecording(result: RecordingResult): void {
    this.recordingResult.set(result);
  }

  /**
   * Whether the microphone is usable, as reported by the recorder.
   *
   * `isMicAllowed` was declared as an output and bound to nothing, so a failure
   * to open the device was silent: the recorder rendered an empty bar and the
   * user was left with a composer that appeared broken.
   *
   * The recorder states the specific reason inline and offers a dismiss button,
   * so this does not close it — that would take the explanation away with it.
   * It only remembers the outcome, so the button cannot keep reopening a
   * recorder that has already failed.
   */
  readonly micUnavailable = signal(false);

  onMicPermission(allowed: boolean): void {
    this.micUnavailable.set(!allowed);
  }

  // ── File / message sending ──────────────────────────────────────────────────

  onEnterKey(event: Event) {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) return;

    event.preventDefault();
    this.sendMessage();
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
      .slice(0, 10 - this.pendingAttachments().length);

    if (!files.length) return;
    event.preventDefault();

    // The slice above already caps this at the remaining allowance, so a
    // further length check here could never fire.
    files.forEach((file) => this.filePicker().processFile(file));
  }

  onFileSelected(event: FileSelectedEvent): void {
    const isDuplicate = this.pendingAttachments().some(
      (a) => a.file.name === event.file.name && a.file.size === event.file.size,
    );
    if (isDuplicate) {
      toast.warning(`"${event.file.name}" is already added.`);
      return;
    }

    if (this.pendingAttachments().length >= 10) {
      toast.error('Maximum 10 attachments per message.', {
        id: 'max-attachment-errors',
      });
      return;
    }
    const context = this.fileContextResolver(event.file);
    this.pendingAttachments.update((list) => [
      ...list,
      {
        tempId: event.tempId,
        file: event.file,
        fileKey: null,
        previewUrl: event.previewUrl,
        context,
        uploading: true,
        error: null,
      },
    ]);
  }

  previewMedia(attachment: PendingAttachment): void {
    if (attachment.context === 'dm-file' || attachment.context === 'dm-audio')
      return;

    const mediaAttachments = (this.pendingAttachments() ?? []).filter(
      (a) => a.context === 'dm-image' || a.context === 'dm-video',
    );

    if (!mediaAttachments.length) return;

    const items: MediaItem[] = mediaAttachments.map((a) => ({
      _id: String(a.tempId),
      uploadId: a.tempId,
      type: a.context === 'dm-image' ? 'image' : 'video',
      url: a.previewUrl || '',
      name: a.file.name,
      size: a.file.size,
    }));

    const clickedIndex = Math.max(
      0,
      mediaAttachments.findIndex((a) => a.tempId === attachment.tempId),
    );

    this.mediaViewerService.openGallery(items, clickedIndex);
  }

  onFileReady(event: FileReadyEvent): void {
    this.pendingAttachments.update((list) =>
      list.map((a) =>
        a.tempId === event.tempId
          ? { ...a, fileKey: event.fileKey, uploading: false }
          : a,
      ),
    );
  }

  onFileError(event: { tempId: string; error: string }): void {
    const attachment = this.pendingAttachments().find(
      (a) => a.tempId === event.tempId,
    );
    if (attachment?.fileKey) this.uploadService.clearUpload(attachment.fileKey);

    // rejected before it ever became a chip (type/size validation) — the only
    // way the user finds out is a toast
    if (!attachment) {
      toast.error(event.error);
      return;
    }

    this.pendingAttachments.update((list) =>
      list.map((a) =>
        a.tempId === event.tempId
          ? { ...a, uploading: false, error: event.error }
          : a,
      ),
    );
  }

  removeAttachment(tempId: string): void {
    const attachment = this.pendingAttachments().find(
      (a) => a.tempId === tempId,
    );
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    this.pendingAttachments.update((list) =>
      list.filter((a) => a.tempId !== tempId),
    );
  }

  clearPendingAttachments(): void {
    this.pendingAttachments().forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      if (a.fileKey) this.uploadService.clearUpload(a.fileKey);
    });
    this.pendingAttachments.set([]);
  }

  sendMessage(): void {
    const stillUploading = this.pendingAttachments().some((a) => a.uploading);
    if (stillUploading) {
      toast.warning('Please wait for all files to finish uploading.');
      return;
    }

    /*
     * Trimmed, and whitespace-only collapsed to nothing.
     *
     * The send button is disabled on `hasSendableContent()`, which trims — but
     * Enter calls straight through to here, so a composer holding only spaces
     * was sendable by keyboard and not by mouse. With no attachment the server
     * refuses it (400, and the optimistic bubble is rolled back); *with* one it
     * is accepted and stored, so the thread keeps a message whose text is a run
     * of spaces. Either way the leading and trailing whitespace of an ordinary
     * message was stored verbatim.
     *
     * `|| null` rather than `?? null`: the empty string left by trimming is
     * exactly the "no text" case the rest of this method already handles.
     */
    const content = this.messageControl.value?.trim() || null;

    if (content && content.length > 2000) {
      toast.error('Message is too long. Maximum length is 2000 characters.');
      return;
    }

    const sender = this.currentUser();
    const activeConversation = this.conversation();
    const now = Date.now();

    if (
      !activeConversation ||
      !sender ||
      !this.canMessage() ||
      now - this.lastMessageSentAt < this.MIN_MESSAGE_INTERVAL
    )
      return;

    this.lastMessageSentAt = now;

    const recordingResult = this.recordingResult();
    const tempId = crypto.randomUUID();

    if (!recordingResult && !content && !this.pendingAttachments().length) {
      return;
    }

    /*
     * One send path.
     *
     * There were four: {voice note, text-or-attachments} × {conversation
     * exists, conversation must be created first}, each repeating the
     * optimistic insert, the input reset, the upload mapping, the error
     * handling and the reconciliation. Whether the conversation already exists
     * is the only real variable, so it is resolved up front and the rest of the
     * flow is written once.
     */
    const recording = recordingResult
      ? this.recordingFile(recordingResult)
      : null;

    // Captured before the inputs are cleared below.
    const attachments = recording
      ? []
      : this.pendingAttachments()
          .filter((a) => !a.uploading && a.fileKey)
          .map((a) => ({
            uploadId: a.fileKey as string,
            context: a.context as string,
            mimeType: a.file.type,
            fileSize: a.file.size,
            originalName: a.file.name,
          }));

    /*
     * The optimistic message carries its attachments, marked `processing`.
     *
     * It used to be created with `attachments: []` and `type: TEXT` regardless
     * of what was being sent, so a photo or a voice note showed *nothing* in
     * the thread between hitting send and the server answering — the media
     * branches all key off the attachment list, found it empty, and rendered
     * an empty bubble. Describing the message accurately from the start means
     * the same processing placeholders that already exist do the right thing
     * for a message that is still in flight, with no special "sending" cases.
     */
    const optimisticAttachments: AttachmentI[] = recording
      ? [
          {
            // The real id arrives with the upload; until then this only has to
            // be stable and unique so `track` does not churn.
            uploadId: tempId,
            context: 'dm-audio',
            mimeType: recording.type,
            fileSize: recording.size,
            status: 'processing',
            variants: null,
            duration: recordingResult?.duration,
          },
        ]
      : attachments.map((a) => ({
          ...a,
          context: a.context as AttachmentI['context'],
          status: 'processing' as const,
          variants: null,
        }));

    const optimisticMessage: MessageI = {
      sender,
      conversation: activeConversation._id,
      content: recording ? undefined : (content ?? undefined),
      tempId,
      type: optimisticMessageType(recording, optimisticAttachments),
      status: MessageStatus.SENDING,
      timestamp: new Date().toISOString(),
      attachments: optimisticAttachments,
    };

    this.resetComposer(!recording);
    this.isMessageLoading.set(true);

    this.ensureConversation(activeConversation, sender)
      .pipe(
        tap((conversationId) => {
          this.messageService.addMessage({
            ...optimisticMessage,
            conversation: conversationId,
          });
          if (conversationId !== activeConversation._id) {
            this.router.navigateByUrl(`/messages/${conversationId}`);
          }
        }),
        switchMap((conversationId) =>
          recording
            ? this.sendRecordedAudio(conversationId, tempId, recording)
            : this.messageService
                .sendMessage(conversationId, content, attachments, tempId)
                .pipe(
                  tap((res) => {
                    this.isMessageLoading.set(false);
                    this.messageService.fillInMessageDetails(res);
                  }),
                ),
        ),
        takeUntilDestroyed(this.destroyRef),
        catchError((err) => this.handleSendError(err, tempId)),
      )
      .subscribe();
  }

  /**
   * The id to send into, creating the conversation first if this is the opening
   * message of one. A mock conversation carries the other user's id in place of
   * a real one and has no `createdAt` — see `createMockConversation()`.
   */
  private ensureConversation(
    conversation: ConversationI,
    sender: UserI,
  ): Observable<string> {
    if (conversation.createdAt) return of(conversation._id);

    return this.conversationService
      .createConversation([sender._id, this.selectedUser()!._id])
      .pipe(map((created) => created._id));
  }

  /** A recording as a file the upload pipeline will accept. */
  private recordingFile(result: RecordingResult): File {
    const blob = result.blob;
    // Derive from the blob: the recorder falls back to other containers when
    // webm is unsupported (Safari), and the codec parameter must be stripped
    // because the server matches the mime type against an exact whitelist.
    const mimeType = (blob.type || 'audio/webm').split(';')[0];
    return new File([blob], `recording.${audioExtension(mimeType)}`, {
      type: mimeType,
    });
  }

  /** Clears the composer once its contents have been captured for sending. */
  private resetComposer(clearTextAndAttachments: boolean): void {
    if (clearTextAndAttachments) {
      this.messageControl.reset();
      const textarea = this.sendInput().nativeElement;
      if (textarea) textarea.style.height = 'auto';
    }
    this.clearPendingAttachments();
  }

  private sendRecordedAudio(
    conversationId: string,
    tempId: string,
    file: File,
  ) {
    return this.uploadService.uploadFile('dm-audio', file).pipe(
      takeUntilDestroyed(this.destroyRef),
      switchMap((uploadId) =>
        this.messageService.sendMessage(
          conversationId,
          null,
          [
            {
              uploadId,
              context: 'dm-audio',
              mimeType: file.type,
              fileSize: file.size,
            },
          ],
          tempId,
        ),
      ),
      tap((res) => {
        this.isRecording.set(false);
        this.recordingResult.set(undefined);
        this.messageService.fillInMessageDetails(res);
      }),
      catchError((err) => this.handleSendError(err, tempId)),
    );
  }

  autoResize(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // ── Pagination ──────────────────────────────────────────────────────────────

  loadMessages(conversationId: string, isMockConversation = false) {
    if (!this.hasMoreMessages() || !conversationId || isMockConversation)
      return [];
    this.messageService.messageOffset.update(
      (val) => val + this.messageLimit(),
    );
    this.isMessageLoading.set(false);
    return this.messageService.activeMessages();
  }

  onChatTopVisible(): void {
    if (!this.observedElement?.() || this.isVisibilityObserving()) return;

    this.isVisibilityObserving.set(true);
    // the callback re-arms isVisibilityObserving, so without this every
    // re-entry would leak another live observer on the same element
    this.divTopIntersectionObserver?.disconnect();
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
          // Edits and deletes arrive for every participant, including the one
          // who made them — the local optimistic update is idempotent, so
          // applying it twice is harmless and a second device stays in sync.
          case 'message-edited':
            this.messageService.applyEdited(res.message);
            break;
          case 'message-deleted':
            this.messageService.applyDeleted(
              res.message._id,
              res.message.deleted_at,
            );
            break;
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
            /*
             * This event goes to everyone the change concerns — the members who
             * left or were removed *and* the ones who stayed. Removing the
             * conversation unconditionally therefore deleted it from the list of
             * every remaining member as well, which is not what happened to
             * them: their membership is intact and only the roster changed.
             *
             * (It went unnoticed because the server was naming its recipients
             * from populated documents, so the remaining members never received
             * this event at all. Fixing that is what made this reachable.)
             */
            const { conversation: left, removed_users } = res;
            const wasRemoved = (removed_users ?? []).some(
              (u: unknown) =>
                (typeof u === 'string' ? u : (u as { _id?: string })?._id) ===
                user?._id,
            );

            if (wasRemoved) {
              this.conversationService.removeConversationFromList(
                left as ConversationI,
              );
              if (this.conversation()?._id === (left as ConversationI)?._id) {
                this.router.navigateByUrl('/messages');
              }
            } else {
              this.conversationService.updateConversationState(
                left as ConversationI,
              );
            }
            break;
          }
          case 'upload-ready': {
            /*
             * The uploader's own confirmation that a group picture is live.
             *
             * Other members learn about it through `conversation-update`, which
             * the worker broadcasts separately. Handling it here as well means
             * the person who made the change does not depend on that second
             * event arriving to see their own picture — the case that made the
             * update look like it required a reload.
             */
            if (res.context === 'group-avatar' && res.resourceId) {
              this.conversationService.applyGroupPicture(
                res.resourceId,
                res.variants?.['medium'] ?? '',
              );
              break;
            }

            this.messageService.updateAttachmentVariants(
              res.uploadId,
              res.variants,
              res.duration,
            );
            break;
          }
          case 'upload-infected': {
            this.messageService.markAttachmentInfected(res.uploadId);
            break;
          }
          case 'upload-failed': {
            this.messageService.markAttachmentFailed(res.uploadId);
            break;
          }
        }
      }),
      catchError((err) => this.handleError(err)),
    );
  }

  @HostListener('document:visibilitychange')
  onVisibilityChange(): void {
    // When the user switches back to this tab
    if (document.visibilityState === 'visible') {
      const activeConversation = this.conversation();
      const currentMessages = this.messages();

      if (activeConversation && currentMessages.length > 0) {
        // Grab the latest message in the active chat (assuming index 0 is the newest based on your effect)
        const lastMessage = currentMessages[0];

        // If it exists and wasn't sent by the current user, mark it as read
        if (
          lastMessage?._id &&
          lastMessage.sender._id !== this.currentUser()?._id
        ) {
          this.messageService.markMessageAsRead(lastMessage._id);
        }
      }
    }
  }
  private markMessageAsRead(message: MessageI): void {
    if (
      !message._id ||
      document.visibilityState !== 'visible' ||
      message.sender._id === this.currentUser()?._id
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
          const activeConversation = this.conversation();
          if (!sender || !activeConversation) return;
          this.webSocketService.sendMessage({
            type: 'typing',
            sender,
            participants: activeConversation.participants,
            is_typing: Boolean(query),
            conversation_id: activeConversation._id,
          } satisfies TypingMessage);
        }),
      )
      .subscribe();
  }

  /**
   * Returns EMPTY, never throwError: these handlers sit on long-lived streams
   * (route params, the websocket feed). Re-throwing tears the subscription down
   * for good, so one failed request would stop every later navigation from
   * loading.
   */
  private handleError(err: any, navigation = false): Observable<never> {
    console.error('[chatbox]', err);
    this.isMessageLoading.set(false);
    this.isConversationLoading.set(false);
    // never leave the composer permanently disabled after a failure
    this.canMessage.set(true);
    if (navigation) this.router.navigate(['/messages']);
    return EMPTY;
  }

  /** Send failed: surface it on the optimistic bubble and re-enable the composer. */
  private handleSendError(err: any, tempId: string): Observable<never> {
    this.messageService.markMessageFailed(tempId);
    toast.error('Message could not be sent.');
    return this.handleError(err);
  }
}

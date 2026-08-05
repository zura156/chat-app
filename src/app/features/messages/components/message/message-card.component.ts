import {
  Component,
  ElementRef,
  effect,
  input,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { UserI } from '../../../user/interfaces/user.interface';
import {
  AttachmentI,
  MessageI,
  MessageType,
} from '../../interfaces/message.interface';
import {
  DatePipe,
  NgClass,
  NgTemplateOutlet,
  TitleCasePipe,
} from '@angular/common';
import { HlmTooltip } from '@spartan-ng/helm/tooltip';
import {
  HlmAvatar,
  HlmAvatarFallback,
  HlmAvatarImage,
} from '@spartan-ng/helm/avatar';
import { TimeAgoPipe } from '../../../../shared/pipes/time-ago.pipe';
import { FormatTimePipe } from '../../../../shared/pipes/format-time.pipe';
import { ConversationService } from '../../services/conversation.service';
import { ReadReceiptI } from '../../interfaces/conversation.interface';
import { environment } from '../../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleStop,
  lucideCirclePause,
  lucideCopy,
  lucideEllipsis,
  lucidePencil,
  lucidePlay,
  lucideCircleX,
  lucideTrash2,
  lucideVolume,
  lucideVolume2,
  lucideVolume1,
  lucideVideo,
  lucideTriangleAlert,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { VideoPlayer } from '../../../../shared/components/video-player/video-player';

import { AudioPlayer } from '../../../../shared/components/audio-player/audio-player';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import { AttachmentPlaceholder } from '../../../../shared/components/attachment-placeholder/attachment-placeholder';
import {
  MediaItem,
  MediaViewerService,
} from '../../../../shared/services/media-viewer.service';
import { FileViewer } from '../../../../shared/components/file-viewer/file-viewer';
import { RouterLink } from '@angular/router';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmButton } from '@spartan-ng/helm/button';
import { LongPressDirective } from '../../../../shared/directives/long-press.directive';
import { MessageActionsService } from '../../services/message-actions.service';

@Component({
  selector: 'message-card',
  imports: [
    NgClass,
    NgTemplateOutlet,
    RouterLink,
    TitleCasePipe,
    TimeAgoPipe,
    FormatTimePipe,
    NgIcon,
    DatePipe,
    FileViewer,
    AudioPlayer,
    HlmIcon,
    HlmTooltip,
    HlmAvatarFallback,
    HlmAvatarImage,
    HlmAvatar,
    HlmSkeleton,
    AttachmentPlaceholder,
    VideoPlayer,
    HlmDropdownMenuImports,
    LongPressDirective,
    HlmButton,
  ],
  providers: [
    provideIcons({
      lucideCircleStop,
      lucideCirclePause,
      lucideCopy,
      lucideEllipsis,
      lucidePencil,
      lucidePlay,
      lucideCircleX,
      lucideTrash2,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVideo,
      // was referenced by the infected-attachment branch but never registered,
      // so that branch rendered a missing icon
      lucideTriangleAlert,
    }),
  ],
  styles: ``,
  templateUrl: './message-card.component.html',
})
export class MessageCardComponent {
  message = input.required<MessageI>();
  readReceipts = input.required<ReadReceiptI[]>();
  imageUrl = input.required<string>();
  currentUser = input.required<UserI>();
  loadedVideoMessageId = signal<string | null>(null);
  isLastMessage = input.required<boolean>();
  isGroup = input<boolean>();

  videoPlayerComponent = viewChild<VideoPlayer>('videoPlayerComponent');

  private readonly editInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('editInput');

  isImageLoaded = signal<boolean>(false);

  conversationService = inject(ConversationService);
  mediaViewerService = inject(MediaViewerService);
  /** Edit, copy and delete all live here — see MessageActionsService. */
  readonly actions = inject(MessageActionsService);

  readonly draft = this.actions.draft;
  readonly busy = this.actions.busy;

  constructor() {
    // Put the caret in the message the moment it becomes editable, at the end
    // of the text rather than the start, and size the box to what is already
    // there instead of an arbitrary two rows.
    effect(() => {
      if (!this.actions.editingId()) return;

      const el = this.editInput()?.nativeElement;
      if (!el) return;

      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      this.resize(el);
    });
  }

  readonly apiUrl = environment.apiUrl;

  isCurrentUserMessage(message: MessageI): boolean {
    return (message.sender._id || message.sender) === this.currentUser()?._id;
  }

  canEdit(message: MessageI): boolean {
    return this.actions.canEdit(message, this.currentUser()?._id);
  }

  canDelete(message: MessageI): boolean {
    return this.actions.canDelete(message, this.currentUser()?._id);
  }

  canCopy(message: MessageI): boolean {
    return this.actions.canCopy(message);
  }

  hasActions(message: MessageI): boolean {
    return this.actions.hasActions(message, this.currentUser()?._id);
  }

  isEditing(message: MessageI): boolean {
    return this.actions.isEditing(message);
  }

  cancelEdit(): void {
    this.actions.cancelEdit();
  }

  saveEdit(message: MessageI): void {
    this.actions.saveEdit(message);
  }

  onDraftInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    this.resize(el);
  }

  /** Enter saves; Shift+Enter is how you get a line break, as in the composer. */
  onEditEnter(event: Event, message: MessageI): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.saveEdit(message);
  }

  private resize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  getUserCredentials(userId: string): {
    username: string;
    pfp_url: string;
  } {
    // The API strips the caller from `participants`, so looking only there
    // rendered your own messages in a group as "Unknown".
    const self = this.currentUser();
    const user =
      self?._id === userId
        ? self
        : this.conversationService
            .activeConversation()
            ?.participants.find((participant) => participant._id === userId);

    return {
      username: user?.username || 'Unknown',
      pfp_url: user?.pfp_url || '/icons/avatar.svg',
    };
  }

  onFullImageLoad(): void {
    this.isImageLoaded.set(true);
  }

  loadVideo(messageId: string): void {
    this.loadedVideoMessageId.set(messageId);
  }

  openMedia(message: MessageI, clicked: AttachmentI): void {
    this.videoPlayerComponent()?.pauseVideo();
    this.loadedVideoMessageId.set(null);

    const readyAttachments = (message.attachments ?? []).filter(
      (a) =>
        a.status === 'ready' &&
        a.variants &&
        (a.context === 'dm-image' || a.context === 'dm-video'),
    );
    if (!readyAttachments.length) return;

    const items: MediaItem[] = readyAttachments.map((a) => ({
      _id: String(message._id),
      uploadId: a.uploadId,
      type: a.context === 'dm-image' ? 'image' : 'video',
      url:
        a.context === 'dm-image'
          ? a.variants!.large || a.variants!.medium || ''
          : a.variants!.original || a.variants!.hls || '',
      thumb: a.variants!.thumb,
      thumbnail: a.variants!.thumbnail || a.variants!.thumb,
      name: a.originalName,
      size: a.fileSize,
    }));

    const clickedIndex = Math.max(
      0,
      readyAttachments.findIndex((a) => a.uploadId === clicked.uploadId),
    );

    this.mediaViewerService.openGallery(items, clickedIndex);
  }

  getPrimaryAttachment(message: MessageI): AttachmentI | null {
    const attachment = message.attachments?.[0];
    if (!attachment || attachment.status !== 'ready' || !attachment.variants)
      return null;
    return attachment;
  }

  isProcessing(message: MessageI): boolean {
    return message.attachments?.some((a) => a.status === 'processing') ?? false;
  }

  hasFailedAttachment(message: MessageI): boolean {
    return (
      message.attachments?.some(
        (a) => a.status === 'failed' || a.status === 'infected',
      ) ?? false
    );
  }

  /**
   * Whether a message is drawn inside a bubble.
   *
   * Text, images and voice messages are: they belong to a sender and the bubble
   * is what says whose they are and which side they are on. Video and files
   * bring their own card, info messages are centred system notes, and a
   * standalone emoji is deliberately bare.
   *
   * Audio used to be in the bare group, which made a voice message the one kind
   * that floated in the thread with no bubble and nothing tying it to anyone.
   *
   * The exception is a failed audio attachment: it renders a destructive chip,
   * and red on a `bg-primary` bubble is not legible. Those keep the plain
   * background the chip was designed against.
   */
  hasBubble(message: MessageI): boolean {
    switch (message.type) {
      case MessageType.INFO:
      case MessageType.VIDEO:
      case MessageType.FILE:
        return false;
      case MessageType.AUDIO:
        return !this.hasFailedAttachment(message);
      default:
        return !this.isOnlyEmoji(message.content || '');
    }
  }

  isOnlyEmoji(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Matches one or more Extended_Pictographic sequences (including skin tones, zero-width joiners, flags)
    const emojiRegex =
      /^(?:(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?|\p{Regional_Indicator}{2}|\d\uFE0F?\u20E3|#\uFE0F?\u20E3|\*\uFE0F?\u20E3)(?:\u200D(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?))*|\s)+$/u;
    return emojiRegex.test(trimmed);
  }
}

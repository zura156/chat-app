import { Component, input, inject, signal, viewChild } from '@angular/core';
import { UserI } from '../../../user/interfaces/user.interface';
import { AttachmentI, MessageI } from '../../interfaces/message.interface';
import {
  DatePipe,
  NgClass,
  NgTemplateOutlet,
  TitleCasePipe,
} from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
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
  lucidePlay,
  lucideCircleX,
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
import {
  MediaItem,
  MediaViewerService,
} from '../../../../shared/services/media-viewer.service';
import { FileViewer } from '../../../../shared/components/file-viewer/file-viewer';
import { RouterLink } from '@angular/router';

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
    MatTooltipModule,
    HlmAvatarFallback,
    HlmAvatarImage,
    HlmAvatar,
    HlmSkeleton,
    VideoPlayer,
  ],
  providers: [
    provideIcons({
      lucideCircleStop,
      lucideCirclePause,
      lucidePlay,
      lucideCircleX,
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

  isImageLoaded = signal<boolean>(false);

  conversationService = inject(ConversationService);
  mediaViewerService = inject(MediaViewerService);

  readonly apiUrl = environment.apiUrl;

  isCurrentUserMessage(message: MessageI): boolean {
    return (message.sender._id || message.sender) === this.currentUser()?._id;
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

  isOnlyEmoji(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Matches one or more Extended_Pictographic sequences (including skin tones, zero-width joiners, flags)
    const emojiRegex =
      /^(?:(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?|\p{Regional_Indicator}{2}|\d\uFE0F?\u20E3|#\uFE0F?\u20E3|\*\uFE0F?\u20E3)(?:\u200D(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?))*|\s)+$/u;
    return emojiRegex.test(trimmed);
  }
}

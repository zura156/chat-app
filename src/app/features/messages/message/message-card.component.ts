import {
  Component,
  ChangeDetectionStrategy,
  input,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from '../interfaces/message.interface';
import { DatePipe, TitleCasePipe } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HlmAvatar,
  HlmAvatarFallback,
  HlmAvatarImage,
} from '@spartan-ng/helm/avatar';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { ConversationService } from '../services/conversation.service';
import { ReadReceiptI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideCircleStop,
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleX,
  lucideDownload,
  lucideVolume,
  lucideVolume2,
  lucideVolume1,
  lucideVideo,
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { VideoPlayer } from '../../../shared/components/video-player/video-player';

import { AudioPlayer } from '../../../shared/components/audio-player/audio-player';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';
import {
  MediaItem,
  MediaViewerService,
} from '../../../shared/services/media-viewer.service';
import { FileViewer } from '../../../shared/components/file-viewer/file-viewer';

@Component({
  selector: 'message-card',
  imports: [
    TitleCasePipe,
    TimeAgoPipe,
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
      lucideCirclePlay,
      lucideCircleX,
      lucideVolume,
      lucideVolume1,
      lucideVolume2,
      lucideVideo,
    }),
  ],
  styles: `
  `,
  templateUrl: './message-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    profile_picture: string;
  } {
    const user = this.conversationService
      .activeConversation()
      ?.participants.find((participant) => participant._id === userId);
    return {
      username: user?.username || 'Unknown',
      profile_picture: user?.profile_picture || '/icons/avatar.svg',
    };
  }

  onFullImageLoad(): void {
    this.isImageLoaded.set(true);
  }

  loadVideo(messageId: string): void {
    this.loadedVideoMessageId.set(messageId);
  }

  openMedia(message: MessageI, index: number) {
    this.videoPlayerComponent()?.pauseVideo();
    this.loadedVideoMessageId.set(null);
    // You can decide based on user preferences or context
    const enableGallery = this.shouldEnableGallery();

    const media: MediaItem = {
      _id: String(message._id),
      type: message.type as 'image' | 'video',
      url: String(message.file?.url),
      placeholder_url: message.file?.placeholder_url,
      thumbnail_url: message.file?.thumbnail_url,
      size: message.file?.size_in_bytes,
    };

    this.mediaViewerService.openMedia(media, index, {
      enableGallery,
      showThumbnails: enableGallery,
      allowDownload: true,
      autoPlay: false,
    });
  }
  private shouldEnableGallery(): boolean {
    return (
      this.mediaViewerService['messageService'].activeMediaMessages().length > 3
    );
  }
}

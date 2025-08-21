import {
  Component,
  ChangeDetectionStrategy,
  input,
  inject,
  signal,
} from '@angular/core';
import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from '../interfaces/message.interface';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
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
} from '@ng-icons/lucide';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { VideoPlayer } from '../../../shared/components/video-player/video-player';

import { AudioPlayer } from '../../../shared/components/audio-player/audio-player';
import { HlmSkeleton } from '@spartan-ng/helm/skeleton';

@Component({
  selector: 'message-card',
  imports: [
    TitleCasePipe,
    TimeAgoPipe,
    NgClass,
    NgIcon,
    DatePipe,
    FileSizePipe,
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
      lucideDownload,
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
  isLastMessage = input.required<boolean>();
  isGroup = input<boolean>();

  isImageLoaded = signal<boolean>(false);
  conversationService = inject(ConversationService);

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
}

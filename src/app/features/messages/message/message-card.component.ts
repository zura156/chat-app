import {
  Component,
  ChangeDetectionStrategy,
  input,
  inject,
  signal,
  linkedSignal,
} from '@angular/core';
import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from '../interfaces/message.interface';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { HlmCardDirective } from '@spartan-ng/helm/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
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
import { HlmIconDirective } from '@spartan-ng/helm/icon';
import { FileSizePipe } from '../../../shared/pipes/file-size.pipe';
import { VideoPlayerComponent } from '../../../shared/components/video-player/video-player.component';
import { HlmSkeletonComponent } from '../../../../../libs/ui/ui-skeleton-helm/src/lib/hlm-skeleton.component';
import { AudioPlayerComponent } from '../../../shared/components/audio-player/audio-player.component';

@Component({
  selector: 'message-card',
  imports: [
    TitleCasePipe,
    TimeAgoPipe,
    NgClass,
    NgIcon,
    DatePipe,
    FileSizePipe,
    AudioPlayerComponent,
    HlmIconDirective,
    MatTooltipModule,
    HlmCardDirective,
    HlmAvatarFallbackDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    VideoPlayerComponent,
    HlmSkeletonComponent,
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

import {
  Component,
  ChangeDetectionStrategy,
  input,
  inject,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from '../interfaces/message.interface';
import { DatePipe, JsonPipe, NgClass, TitleCasePipe } from '@angular/common';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/ui-avatar-helm';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { ConversationService } from '../services/conversation.service';
import { ReadReceiptI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { provideIcons } from '@ng-icons/core';
import {
  lucideCircleStop,
  lucideCirclePause,
  lucideCirclePlay,
  lucideCircleX,
} from '@ng-icons/lucide';
import {
  BrnProgressComponent,
  BrnProgressIndicatorComponent,
} from '@spartan-ng/brain/progress';
import { HlmProgressIndicatorDirective } from '@spartan-ng/ui-progress-helm';

@Component({
  selector: 'message-card',
  imports: [
    TitleCasePipe,
    TimeAgoPipe,
    NgClass,
    DatePipe,
    BrnProgressComponent,
    BrnProgressIndicatorComponent,
    HlmProgressIndicatorDirective,
    MatTooltipModule,
    HlmCardDirective,
    HlmAvatarFallbackDirective,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
  ],
  providers: [
    provideIcons({
      lucideCircleStop,
      lucideCirclePause,
      lucideCirclePlay,
      lucideCircleX,
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

  audioCurrentTime = signal<number>(0);
  audioDuration = signal<number>(0);

  audioPlayerRef = viewChild<ElementRef>('audioPlayer');

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

  onTimeUpdate(audio: HTMLAudioElement): void {
    this.audioCurrentTime.set(audio.currentTime);
  }

  onMetadataLoaded() {
    const audioPlayer = this.audioPlayerRef();
    if (audioPlayer) {
      const timer = setInterval(() => {
        if (
          !isNaN(audioPlayer.nativeElement.duration) ||
          audioPlayer.nativeElement.duration !== Infinity
        ) {
          this.audioDuration.set(audioPlayer.nativeElement.duration);
          console.log('Audio duration:', this.audioDuration());
        }
      }, 100);
    }
  }

  getProgressBarPercentage(): number {
    return Math.floor((this.audioCurrentTime() / this.audioDuration()) * 100);
  }

  seekAudio(event: Event, audio: HTMLAudioElement): void {
    const input = event.target as HTMLInputElement;
    const seekTime = parseFloat(input.value);
    audio.currentTime = seekTime;
    this.audioCurrentTime.set(seekTime);
  }

  formatTime(time: number): string {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
}

import {
  Component,
  ChangeDetectionStrategy,
  input,
  inject,
  signal,
  viewChild,
  ElementRef,
  linkedSignal,
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
import { NgIcon, provideIcons } from '@ng-icons/core';
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
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';

@Component({
  selector: 'message-card',
  imports: [
    TitleCasePipe,
    TimeAgoPipe,
    NgClass,
    NgIcon,
    DatePipe,
    BrnProgressComponent,
    BrnProgressIndicatorComponent,
    HlmProgressIndicatorDirective,
    HlmIconDirective,
    HlmButtonDirective,
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
  audioDuration = linkedSignal<number>(
    () => this.message()?.file?.duration || 0
  );
  audioProgressPercentage = linkedSignal<number>(() => {
    const duration = this.audioDuration();

    return duration > 0
      ? Math.floor((this.audioCurrentTime() / this.audioDuration()) * 100)
      : 0;
  });

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

    if (audio.paused || audio.ended) {
      this.audioProgressPercentage.set(100);
    }
  }

  formatTime(time: number): string {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }
}

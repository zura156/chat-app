import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { UserI } from '../../user/interfaces/user.interface';
import { MessageI } from '../interfaces/message.interface';
import { NgClass, TitleCasePipe } from '@angular/common';
import { HlmCardDirective } from '@spartan-ng/ui-card-helm';
import { HlmAvatarComponent, HlmAvatarFallbackDirective, HlmAvatarImageDirective } from '@spartan-ng/ui-avatar-helm';

@Component({
  selector: 'message-card',
  imports: [TitleCasePipe, NgClass, HlmCardDirective, HlmAvatarFallbackDirective, HlmAvatarImageDirective, HlmAvatarComponent],
  templateUrl: './message-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageCardComponent {
  message = input.required<MessageI>();
  imageUrl = input.required<string>();
  currentUser = input.required<UserI>();
  index = input.required<number>();
  isGroup = input<boolean>();

  isCurrentUserMessage(message: MessageI): boolean {
    return (message.sender._id || message.sender) === this.currentUser()?._id;
  }
}

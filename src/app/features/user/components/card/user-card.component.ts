import { Component, input } from '@angular/core';
import { UserI } from '../../interfaces/user.interface';
import { HlmCardDirective } from '@spartan-ng/helm/card';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/helm/avatar';
import { ParticipantI } from '../../../messages/interfaces/participant.interface';

@Component({
  selector: 'app-user-card',
  imports: [
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmAvatarFallbackDirective,
    HlmCardDirective,
  ],
  templateUrl: './user-card.component.html',
})
export class UserCardComponent {
  user = input<UserI | ParticipantI>();
  imageUrl = this.user()?.profile_picture;
}

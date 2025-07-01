import { Component, input } from '@angular/core';
import { UserI } from '../../interfaces/user.interface';
import { HlmCardDirective } from '@spartan-ng/helm/card';
import {
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
  HlmAvatarImageDirective,
} from '@spartan-ng/helm/avatar';

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
  user = input<UserI>();
  imageUrl = this.user()?.profile_picture;
}

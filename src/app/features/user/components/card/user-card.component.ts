import { Component, input } from '@angular/core';
import { UserI } from '../../interfaces/user.interface';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { ParticipantI } from '../../../messages/interfaces/participant.interface';

@Component({
  selector: 'app-user-card',
  imports: [HlmAvatarImports],
  templateUrl: './user-card.component.html',
})
export class UserCardComponent {
  user = input<UserI | ParticipantI>();
}

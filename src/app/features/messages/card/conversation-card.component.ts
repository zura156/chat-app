import { Component, inject, input, linkedSignal } from '@angular/core';
import { HlmCardDirective } from '@spartan-ng/helm/card';
import { ConversationI } from '../interfaces/conversation.interface';
import { RouterLink } from '@angular/router';
import { LayoutService } from '../layout/layout.service';
import { HlmIconModule } from '../../../../../libs/ui/ui-icon-helm/src/index';
import {
  HlmAvatarComponent,
  HlmAvatarImageDirective,
} from '@spartan-ng/helm/avatar';
import { UserService } from '../../user/services/user.service';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { environment } from '../../../../environments/environment';
import { NavController } from '@ionic/angular/standalone';

@Component({
  selector: 'app-conversation-card',
  imports: [
    HlmCardDirective,
    HlmIconModule,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    TimeAgoPipe,
  ],
  templateUrl: './conversation-card.component.html',
})
export class ConversationCardComponent {
  layoutService = inject(LayoutService);
  userService = inject(UserService);
  navCtrl = inject(NavController);

  conversation = input<ConversationI>();

  apiUrl = environment.apiUrl;

  currentUser = this.userService.currentUser;
  participants = linkedSignal(() =>
    this.conversation()?.participants?.filter(
      (p) => p._id !== this.currentUser()?._id
    )
  );

  imageUrl = this.conversation()?.group_picture;

  switchView(id: string): void {
    this.layoutService.setActiveView('chatbox');
    this.navCtrl.navigateForward(['/messages', id], {
      animationDirection: 'forward',
    });
  }
}

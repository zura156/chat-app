import { Component, inject, input, linkedSignal } from '@angular/core';
import { ConversationI } from '../interfaces/conversation.interface';
import { LayoutService } from '../layout/layout.service';
import { HlmIconModule } from '../../../../../libs/ui/ui-icon-helm/src/index';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { environment } from '../../../../environments/environment';
import { NavController } from '@ionic/angular/standalone';
import { UserStateService } from '../../user/services/user-state.service';

@Component({
  selector: 'app-conversation-card',
  imports: [HlmIconModule, HlmAvatarImports, TimeAgoPipe],
  templateUrl: './conversation-card.component.html',
})
export class ConversationCardComponent {
  layoutService = inject(LayoutService);
  userStateService = inject(UserStateService);
  navCtrl = inject(NavController);

  conversation = input<ConversationI>();

  apiUrl = environment.apiUrl;

  currentUser = this.userStateService.currentUser;
  participants = linkedSignal(() =>
    this.conversation()?.participants?.filter(
      (p) => p._id !== this.currentUser()?._id
    )
  );

  imageUrl = this.conversation()?.group_picture;

  switchView(id: string): void {
    this.layoutService.setActiveView('chatbox');
    this.navCtrl.navigateRoot(['/messages', id], {
      animationDirection: 'forward',
    });
  }
}

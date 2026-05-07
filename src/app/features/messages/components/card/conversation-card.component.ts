import {
  Component,
  inject,
  input,
  linkedSignal,
  OnInit,
  signal,
} from '@angular/core';
import { ConversationI } from '../../interfaces/conversation.interface';
import { LayoutService } from '../../services/layout.service';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { TimeAgoPipe } from '../../../../shared/pipes/time-ago.pipe';
import { environment } from '../../../../../environments/environment';
import { UserStateService } from '../../../user/services/user-state.service';
import { Router } from '@angular/router';
// import { NotificationService } from '../../services/notification.service';
// import { computed } from '@angular/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';

@Component({
  selector: 'app-conversation-card',
  imports: [HlmIconImports, HlmAvatarImports, TimeAgoPipe, HlmBadgeImports],
  templateUrl: './conversation-card.component.html',
})
export class ConversationCardComponent {
  private layoutService = inject(LayoutService);
  private userStateService = inject(UserStateService);
  // private notificationService = inject(NotificationService);
  private router = inject(Router);

  conversation = input.required<ConversationI>();
  // unreadCount = computed(() =>
  //   this.notificationService.unreadForConversation(this.conversation()._id)(),
  // );

  apiUrl = environment.apiUrl;

  currentUser = this.userStateService.currentUser;
  participants = linkedSignal(() =>
    this.conversation()?.participants?.filter(
      (p) => p._id !== this.currentUser()?._id,
    ),
  );

  switchView(id: string): void {
    this.layoutService.setActiveView('chatbox');
    this.router.navigate(['/messages', id]);
  }

  hasRead(conversation: ConversationI | null): boolean {
    const currentUser = this.currentUser();
    if (!conversation || !currentUser) return false;

    const lastMessage = conversation.last_message;

    if (!lastMessage) return false;

    return (
      conversation.read_receipts.find(
        (readReceipt) => readReceipt.user_id === currentUser?._id,
      )?.last_message_read_id === lastMessage._id
    );
  }
}

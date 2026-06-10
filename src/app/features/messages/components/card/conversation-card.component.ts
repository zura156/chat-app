import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
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
import { MessageI } from '../../interfaces/message.interface';

@Component({
  selector: 'app-conversation-card',
  imports: [HlmIconImports, HlmAvatarImports, TimeAgoPipe, HlmBadgeImports],
  templateUrl: './conversation-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

    if (lastMessage.sender?._id === currentUser._id) return true;

    return (
      conversation.read_receipts.find((r) => r.user_id === currentUser._id)
        ?.last_message_read_id === lastMessage._id
    );
  }

  getAttachmentPreview(message: MessageI): string {
    switch (message.type) {
      case 'image':
        return '\u{1F4F7} Photo'; // 📷
      case 'video':
        return '\u{1F3A5} Video'; // 🎥
      case 'audio':
        return '\u{1F3A4} Voice message'; // 🎤
      case 'file':
        return (
          '\u{1F4CE} ' + (message.attachments?.[0]?.originalName ?? 'File')
        ); // 📎
      default:
        return '';
    }
  }
}

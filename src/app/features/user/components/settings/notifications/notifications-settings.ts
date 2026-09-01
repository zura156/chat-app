import { Component, OnInit, computed, inject } from '@angular/core';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { NotificationSettingsService } from './notification-settings.service';
import { ConversationI } from '../../../../messages/interfaces/conversation.interface';
import { UserStateService } from '../../../services/user-state.service';

/**
 * This screen used to render a hardcoded list of toggles — new messages,
 * mentions, app updates — with no GET, no PATCH and no preferences model behind
 * them. Every one of them was inert.
 *
 * Per-conversation mute is the notification preference the server actually
 * implements and honours, so that is what is surfaced here instead.
 */
@Component({
  templateUrl: './notifications-settings.html',
  imports: [HlmSeparatorImports],
})
export class Notificationssettings implements OnInit {
  private readonly settings = inject(NotificationSettingsService);
  private readonly userStateService = inject(UserStateService);

  readonly loading = this.settings.loading;
  readonly conversations = this.settings.conversations;
  readonly pending = this.settings.pending;

  readonly mutedCount = computed(() => {
    const ids = this.settings.mutedIds();
    return this.conversations().filter((c) => ids.has(c._id)).length;
  });

  ngOnInit(): void {
    this.settings.load().subscribe();
  }

  isMuted(conversationId: string): boolean {
    return this.settings.isMuted(conversationId);
  }

  isPending(conversationId: string): boolean {
    return this.pending().has(conversationId);
  }

  toggle(conversationId: string): void {
    if (this.isPending(conversationId)) return;
    this.settings.toggleMute(conversationId).subscribe();
  }

  /** Mirrors how the conversation card titles a chat. */
  nameOf(conversation: ConversationI): string {
    if (conversation.is_group && conversation.group_name) {
      return conversation.group_name;
    }

    const currentUserId = this.userStateService.currentUser()?._id;
    const others = (conversation.participants ?? []).filter(
      (p) => p._id !== currentUserId,
    );

    if (others.length === 0) return 'Just you';
    return others.map((p) => p.username).join(', ');
  }

  avatarOf(conversation: ConversationI): string {
    if (conversation.is_group) {
      return conversation.group_picture ?? '/icons/group.svg';
    }

    const currentUserId = this.userStateService.currentUser()?._id;
    const other = (conversation.participants ?? []).find(
      (p) => p._id !== currentUserId,
    );

    return other?.pfp_url ?? '/icons/avatar.svg';
  }
}

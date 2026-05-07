import { inject, Injectable } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { ConversationService } from './conversation.service';
import { UserService } from '../../user/services/user.service';
import { ConversationI } from '../interfaces/conversation.interface';
import { toast } from '@spartan-ng/brain/sonner';
import { noOnlyWhitespace } from '../../../shared/validators/no-only-whitespace.validator';

@Injectable()
export class ChatboxSettingsService {
  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private fb = inject(FormBuilder);

  buildChatNameForm(currentName: string) {
    return this.fb.group({
      groupName: new FormControl(currentName, [
        Validators.minLength(1),
        Validators.maxLength(50),
        noOnlyWhitespace(),
      ]),
    });
  }

  updateChatName(conversationId: string, newName: string, currentName: string) {
    if (newName === currentName) {
      toast.info('No changes made', { description: 'Name remains the same.' });
      return null;
    }
    return this.conversationService.updateConversation(conversationId, {
      group_name: newName,
    });
  }

  updateChatPicture(conversationId: string, file: File) {
    return this.conversationService.updateConversation(conversationId, {
      group_picture: file,
    });
  }

  addMembers(memberIds: string[], conversationId: string) {
    return this.conversationService.manageConversationMembers(
      { add: memberIds, remove: [] },
      conversationId,
    );
  }

  removeMember(userId: string, conversationId: string) {
    return this.conversationService.manageConversationMembers(
      { add: [], remove: [userId] },
      conversationId,
    );
  }

  leaveGroup(userId: string, conversationId: string) {
    return this.conversationService.manageConversationMembers(
      { add: [], remove: [userId] },
      conversationId,
    );
  }

  getFilteredUsers(conversation: ConversationI) {
    const users = this.userService.users()?.users ?? [];
    const participantIds = new Set(conversation.participants.map((p) => p._id));
    return users.filter((u) => !participantIds.has(u._id));
  }

  formatUsernames(users: { username: string }[]): string {
    if (!users?.length) return '';
    const names = users.map((u) => u.username);
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
  }
}

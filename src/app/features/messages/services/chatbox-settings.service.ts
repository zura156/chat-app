import { inject, Injectable } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { ConversationService } from './conversation.service';
import { UserService } from '../../user/services/user.service';
import { ConversationI } from '../interfaces/conversation.interface';
import { toast } from '@spartan-ng/brain/sonner';
import { noOnlyWhitespace } from '../../../shared/validators/no-only-whitespace.validator';
import { UploadService } from '../../upload/services/upload.service';

@Injectable()
export class ChatboxSettingsService {
  private conversationService = inject(ConversationService);
  private userService = inject(UserService);
  private uploadService = inject(UploadService);
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

  /**
   * Group pictures go through the presign → upload → confirm pipeline; the
   * worker writes `group_picture` on completion (onGroupAvatarComplete).
   * Posting the raw File to the conversation endpoint did nothing: there is no
   * multipart parser on the API.
   */
  updateChatPicture(conversationId: string, file: File) {
    return this.uploadService.uploadFile('group-avatar', file, conversationId);
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

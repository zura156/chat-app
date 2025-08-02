import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient, httpResource } from '@angular/common/http';
import { debounceTime, Observable, of } from 'rxjs';
import { MessageI, MessageStatus } from '../interfaces/message.interface';
import { MessageListI } from '../interfaces/message-list.interface';
import { ParticipantI } from '../interfaces/participant.interface';
import { ConversationService } from './conversation.service';
import { WebSocketService } from './web-socket.service';
import {
  ChatMessage,
  MessageStatusMessage,
} from '../interfaces/web-socket-message.interface';
import { UserStateService } from '../../user/services/user-state.service';

@Injectable()
export class MessageService {
  private http = inject(HttpClient);
  private conversationService = inject(ConversationService);
  private userStateService = inject(UserStateService);
  private webSocketService = inject(WebSocketService);

  private apiUrl = `${environment.apiUrl}/messages`;

  // private readonly SEND_MESSAGE_URL = `${this.apiUrl}/send`;
  private readonly GET_MESSAGES_URL = `${this.apiUrl}`;
  private readonly UPLOAD_FILE_MESSAGE_URL = `${this.apiUrl}/upload`;

  // flags
  messageOffset = signal<number>(0);
  messageLimit = signal<number>(20);
  hasMoreMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.messageOffset() + this.messageLimit() <= totalCount;
  });

  // signals for message management
  #activeMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeMessagesResource.value() || { messages: [], totalCount: 0 },
    computation: (newResource, previous) => {
      const conversation = this.conversationService.activeConversation();
      const previousMessages = previous?.value ?? [];

      if (!conversation || !conversation._id || !newResource) {
        return [];
      }

      const isInitialLoad = previousMessages.length === 0;
      const isDifferentConversation =
        !isInitialLoad &&
        previousMessages[0]?.conversation !== conversation._id;

      if (isInitialLoad || isDifferentConversation) {
        return newResource.messages;
      } else {
        const messageMap = new Map<string, MessageI>();
        previousMessages.forEach((msg) =>
          msg._id ? messageMap.set(msg._id, msg) : ''
        );
        newResource.messages.forEach((msg) =>
          msg._id ? messageMap.set(msg._id, msg) : ''
        );

        const messages = Array.from(messageMap.values());

        return messages;
      }
    },
  });

  activeMessages: Signal<MessageI[]> = computed<MessageI[]>(
    this.#activeMessages
  );

  #totalMessagesCount: WritableSignal<number> = linkedSignal<number>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;

    return totalCount || 0;
  });
  totalMessagesCount: Signal<number> = computed<number>(
    this.#totalMessagesCount
  );

  constructor() {
    effect(() => {
      const messages = this.activeMessages();
      const conversation = this.conversationService.activeConversation();

      if (messages.length > 0 && conversation?._id) {
        const firstMessage = messages[0];
        if (firstMessage?._id) {
          this.markMessageAsRead(firstMessage._id);
        }
      }
    });
  }

  sendMessage(
    message: MessageI,
    participants: Partial<ParticipantI>[],
    isNewest: boolean = false
  ): Observable<MessageI> {
    const data: ChatMessage = {
      type: 'message',
      message,
      participants,
    };

    this.addMessage(message, isNewest);
    this.webSocketService.sendMessage(data);

    return of(message);
  }

  activeMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    if (!conversationId) {
      return;
    }

    const url = `${
      this.GET_MESSAGES_URL
    }/${conversationId}/messages?offset=${this.messageOffset()}&limit=${this.messageLimit()}`;
    return url;
  });

  markMessageAsRead(lastMessageId: string) {
    if (!lastMessageId) return;

    const user = this.userStateService.currentUser();
    const message = this.findMessageById(lastMessageId);
    if (!user || !message) return;

    const currentUserId = user._id;
    const conversation = this.conversationService.activeConversation();

    if (
      conversation &&
      conversation.read_receipts.some(
        (r) =>
          r.user_id === currentUserId &&
          r.last_message_read_id === lastMessageId
      )
    )
      return;

    if (!currentUserId || !conversation?._id) return;

    // Then send to server via websocket
    const readData: MessageStatusMessage = {
      type: 'message-status',
      read_receipt: {
        last_message_read_id: lastMessageId,
        read_at: new Date(),
        user_id: currentUserId,
      },
      conversation_id: conversation._id,
      status: 'read',
    };

    this.webSocketService.sendMessage(readData);
  }

  updateMessageStatus(messageId: string, status: MessageStatus): void {
    this.#activeMessages.update((messages) => {
      const messageIndex = messages.findIndex((msg) => msg._id === messageId);

      if (messageIndex === -1) {
        return messages;
      }

      const updatedMessages = [...messages];
      updatedMessages[messageIndex] = {
        ...updatedMessages[messageIndex],
        status,
      };

      return updatedMessages;
    });
  }

  // Add a single message to the active messages (useful for real-time updates)
  addMessage(message: MessageI, isNewest: boolean = false): void {
    this.#activeMessages.update((currentMessages) => {
      if (isNewest) {
        return currentMessages;
      } else {
        return [message, ...currentMessages];
      }
    });
  }

  uploadFileMessage(formData: FormData): Observable<any> {
    return this.http
      .post(this.UPLOAD_FILE_MESSAGE_URL, formData)
      .pipe(debounceTime(500));
  }

  // Clear active messages (useful when changing conversations)
  clearActiveMessages(): void {
    this.#activeMessages.set([]);
  }

  fillInMessageDetails(message: MessageI): void {
    this.#activeMessages.update((val) => {
      val.shift();
      return [message, ...val];
    });
  }

  private findMessageById(messageId: string): MessageI | undefined {
    const message = this.activeMessages().find((m) => m._id === messageId);
    if (message) {
      return message;
    }

    return undefined;
  }
}

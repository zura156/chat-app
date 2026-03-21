import {
  computed,
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
  private readonly UPLOAD_FILE_MESSAGE_URL = `${this.apiUrl}/upload`;

  previousConversationId = signal<string | null>(null);

  // state management for all messages
  messageOffset = signal<number>(0);
  messageLimit = signal<number>(20);
  hasMoreMessages = linkedSignal<boolean>(() => {
    const totalCount = this.totalMessagesCount();
    if (totalCount === undefined) {
      return false;
    }
    return this.messageOffset() + this.messageLimit() <= totalCount;
  });

  // state management for media messages
  mediaMessageOffset = signal<number>(0);
  mediaMessageLimit = signal<number>(20);
  hasMoreMediaMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeMediaMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.mediaMessageOffset() + this.mediaMessageLimit() <= totalCount;
  });

  // state management for file messages
  fileMessageOffset = signal<number>(0);
  fileMessageLimit = signal<number>(20);
  hasMoreFileMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeFileMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.fileMessageOffset() + this.fileMessageLimit() <= totalCount;
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
          msg._id ? messageMap.set(msg._id, msg) : '',
        );
        newResource.messages.forEach((msg) =>
          msg._id ? messageMap.set(msg._id, msg) : '',
        );
        const messages = Array.from(messageMap.values());

        return messages;
      }
    },
  });

  activeMessages: Signal<MessageI[]> = computed<MessageI[]>(() => {
    return this.#activeMessages();
  });

  #totalMessagesCount: WritableSignal<number> = linkedSignal<number>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;

    return totalCount || 0;
  });
  totalMessagesCount: Signal<number> = computed<number>(
    this.#totalMessagesCount,
  );

  #activeMediaMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeMediaMessagesResource.value() || {
        messages: [],
        totalCount: 0,
      },
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
          msg._id ? messageMap.set(msg._id, msg) : '',
        );
        newResource.messages.forEach((msg) =>
          msg._id ? messageMap.set(msg._id, msg) : '',
        );

        const messages = Array.from(messageMap.values());

        return messages;
      }
    },
  });

  activeMediaMessages: Signal<MessageI[]> = computed<MessageI[]>(
    this.#activeMediaMessages,
  );

  #totalMediaMessagesCount: WritableSignal<number> = linkedSignal<number>(
    () => {
      const totalCount = this.activeMediaMessagesResource.value()?.totalCount;

      return totalCount || 0;
    },
  );
  totalMediaMessagesCount: Signal<number> = computed<number>(
    this.#totalMediaMessagesCount,
  );

  #activeFileMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeFileMessagesResource.value() || {
        messages: [],
        totalCount: 0,
      },
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
          msg._id ? messageMap.set(msg._id, msg) : '',
        );
        newResource.messages.forEach((msg) =>
          msg._id ? messageMap.set(msg._id, msg) : '',
        );

        const messages = Array.from(messageMap.values());

        return messages;
      }
    },
  });

  activeFileMessages: Signal<MessageI[]> = computed<MessageI[]>(
    this.#activeFileMessages,
  );

  #totalFileMessagesCount: WritableSignal<number> = linkedSignal<number>(() => {
    const totalCount = this.activeFileMessagesResource.value()?.totalCount;

    return totalCount || 0;
  });
  totalFileMessagesCount: Signal<number> = computed<number>(
    this.#totalFileMessagesCount,
  );

  // Control signals for on-demand fetching
  private shouldFetchMediaMessages = signal<boolean>(false);
  private shouldFetchFileMessages = signal<boolean>(false);

  sendMessage(
    message: MessageI,
    participants: Partial<ParticipantI>[],
    isNewest: boolean = false,
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

    if (
      !conversationId ||
      conversationId === this.userStateService.selectedUser()?._id
    ) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/messages?offset=${this.messageOffset()}&limit=${this.messageLimit()}`;
    return url;
  });

  activeMediaMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchMediaMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/media?offset=${this.mediaMessageOffset()}&limit=${this.mediaMessageLimit()}`;
    return url;
  });

  activeFileMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchFileMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/files?offset=${this.fileMessageOffset()}&limit=${this.fileMessageLimit()}`;
    return url;
  });

  // Public methods to trigger media/file message fetching from components
  fetchMediaMessages(): void {
    this.shouldFetchMediaMessages.set(true);
  }

  fetchFileMessages(): void {
    this.shouldFetchFileMessages.set(true);
  }

  // Method to load more media messages
  loadMoreMediaMessages(): void {
    if (this.hasMoreMediaMessages()) {
      this.mediaMessageOffset.update(
        (offset) => offset + this.mediaMessageLimit(),
      );
    }
  }

  // Method to load more file messages
  loadMoreFileMessages(): void {
    if (this.hasMoreFileMessages()) {
      this.fileMessageOffset.update(
        (offset) => offset + this.fileMessageLimit(),
      );
    }
  }

  // Methods to reset fetching state (useful when changing conversations)
  resetMediaMessagesFetch(): void {
    this.shouldFetchMediaMessages.set(false);
    this.mediaMessageOffset.set(0);
    this.#activeMediaMessages.set([]);
  }

  resetFileMessagesFetch(): void {
    this.shouldFetchFileMessages.set(false);
    this.fileMessageOffset.set(0);
    this.#activeFileMessages.set([]);
  }

  markMessageAsRead(lastMessageId: string) {
    if (!lastMessageId) return;

    const user = this.userStateService.currentUser();
    const message = this.findMessageById(lastMessageId);
    if (!user || !message) return;

    const currentUserId = user._id;
    const conversation = this.conversationService.activeConversation();

    if (!currentUserId || !conversation?._id) return;

    if (
      conversation &&
      conversation.read_receipts.find((r) => r.user_id === currentUserId)
        ?.last_message_read_id === lastMessageId
    ) {
      return;
    }

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

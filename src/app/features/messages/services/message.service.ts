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
import { ChatMessage } from '../interfaces/web-socket-message.interface';

@Injectable()
export class MessageService {
  private http = inject(HttpClient);
  private conversationService = inject(ConversationService);
  private webSocketService = inject(WebSocketService);

  private apiUrl = `${environment.apiUrl}/messages`;

  // private readonly SEND_MESSAGE_URL = `${this.apiUrl}/send`;
  private readonly GET_MESSAGES_URL = `${this.apiUrl}`;
  private readonly UPLOAD_FILE_MESSAGE_URL = `${this.apiUrl}/upload`;

  // flags
  offset = signal<number>(0);
  messageLimit = signal<number>(20);
  hasMoreMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.offset() < totalCount;
  });

  // signals for message management
  #activeMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeMessagesResource.value() || { messages: [], totalCount: 0 },
    computation: (newResource, previous) => {
      const conversationId = this.conversationService.activeConversation()?._id;
      const previousMessages = previous?.value ?? [];

      if (!conversationId || !newResource) {
        return [];
      }

      const isInitialLoad = previousMessages.length === 0;
      const isDifferentConversation =
        !isInitialLoad && previousMessages[0]?.conversation !== conversationId;

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

        return Array.from(messageMap.values());
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

  // old approach to get messages by conversation ID
  // This method is commented out because we are now using the new httpResource approach (activeMessagesResource)
  // // Get messages for a conversation
  // getMessagesByConversationId(
  //   conversationId: string,
  //   offset = 0,
  //   limit = 20
  // ): Observable<MessageListI> {
  //   const url = `${this.GET_MESSAGES_URL}/${conversationId}/messages?offset=${offset}&limit=${limit}`;

  //   return this.http.get<MessageListI>(url).pipe(
  //     tap((response) => {
  //       if (
  //         this.activeMessages().length > 0 &&
  //         this.activeMessages().length !== response.totalCount &&
  //         this.activeMessages().some((m) => m.conversation === conversationId)
  //       ) {
  //         this.#activeMessages.update((val) => [...val, ...response.messages]);
  //       } else {
  //         this.#activeMessages.set(response.messages);
  //       }
  //       this.#totalMessagesCount.set(response.totalCount);
  //     }),
  //     catchError((error) => {
  //       console.error('Error fetching messages:', error);
  //       return throwError(
  //         () => new Error(error.message || 'Failed to fetch messages')
  //       );
  //     })
  //   );
  // }

  activeMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    if (!conversationId) {
      return;
    }
    const url = `${
      this.GET_MESSAGES_URL
    }/${conversationId}/messages?offset=${this.offset()}&limit=${this.messageLimit()}`;
    return url;
  });

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
}

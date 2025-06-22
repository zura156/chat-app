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
import {
  catchError,
  debounceTime,
  map,
  Observable,
  of,
  tap,
  throwError,
} from 'rxjs';
import {
  MessageI,
  MessageStatus,
  MessageType,
} from '../interfaces/message.interface';
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
  limit = 20;
  hasMoreMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.offset() < totalCount;
  });

  // signals for message management
  #activeMessages = linkedSignal<MessageI[]>(
    () => this.activeMessagesResource.value()?.messages || []
  );
  activeMessages = computed(this.#activeMessages);

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
    const conversationId = this.conversationService.activeConversation()?._id;
    console.log(conversationId)
    if (!conversationId) {
      return;
    }
    const url = `${
      this.GET_MESSAGES_URL
    }/${conversationId}/messages?offset=${this.offset()}&limit=${this.limit}`;
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
    return this.http.post(this.UPLOAD_FILE_MESSAGE_URL, formData);
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
    console.log(this.activeMessages())
  }
}

import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
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

  private apiUrl = `${environment.apiUrl}/message`;

  private readonly SEND_MESSAGE_URL = `${this.apiUrl}/send`;
  private readonly GET_MESSAGES_URL = `${this.apiUrl}/conversation`;

  // ! old idea
  // #activeMessages = linkedSignal<MessageI[]>(() => {
  //   const conversationId = this.conversationService.activeConversation()?._id;
  //   if (conversationId) {
  //     this.getMessagesByConversationId(conversationId)
  //       .pipe(map((convo) => convo.messages))
  //       .subscribe();
  //   }
  //   return [];
  // });

  #activeMessages = signal<MessageI[]>([]);
  activeMessages = computed(this.#activeMessages);

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

  // Get messages for a conversation
  getMessagesByConversationId(
    conversationId: string,
    offset = 0,
    limit = 20
  ): Observable<MessageListI> {
    const url = `${this.GET_MESSAGES_URL}/${conversationId}/messages?offset=${offset}&limit=${limit}`;

    return this.http.get<MessageListI>(url).pipe(
      tap((response) => {
        if (
          this.activeMessages().length > 0 &&
          conversationId !== (this.activeMessages()[0].conversation as string)
        ) {
          this.#activeMessages.update((val) => [...val, ...response.messages]);
        }
        this.#activeMessages.set(response.messages);
      }),
      catchError((error) => {
        console.error('Error fetching messages:', error);
        return throwError(
          () => new Error(error.message || 'Failed to fetch messages')
        );
      })
    );
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

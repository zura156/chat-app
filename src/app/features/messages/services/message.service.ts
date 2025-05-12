import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import { MessageI, MessageType } from '../interfaces/message.interface';
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
    participants: Partial<ParticipantI>[]
  ): Observable<MessageI> {
    const data: ChatMessage = {
      type: 'message',
      message,
      participants,
    };

    this.webSocketService.sendMessage(data);
    this.#activeMessages.update((messages) => [message, ...messages]);

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
      tap((messages) => {
        this.#activeMessages.update((val) => [...val, ...messages.messages]);
        if (
          this.activeMessages().length > 0 &&
          conversationId !== (this.activeMessages()[0].conversation as string)
        ) {
          this.#activeMessages.set(messages.messages);
        }
      }),
      catchError((error) => {
        console.error('Error fetching messages:', error);
        return throwError(
          () => new Error(error.message || 'Failed to fetch messages')
        );
      })
    );
  }

  // Mark messages as read
  markMessagesAsRead(conversationId: string): Observable<any> {
    const url = `${this.GET_MESSAGES_URL}/${conversationId}/read`;

    return this.http.post(url, {}).pipe(
      catchError((error) => {
        console.error('Error marking messages as read:', error);
        return throwError(
          () => new Error(error.message || 'Failed to mark messages as read')
        );
      })
    );
  }

  // Add a single message to the active messages (useful for real-time updates)
  addMessage(message: MessageI): void {
    this.#activeMessages.update((messages) => [message, ...messages]);
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

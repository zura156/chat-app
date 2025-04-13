import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { MessageI, MessageType } from '../interfaces/message.interface';
import { MessageListI } from '../interfaces/message-list.interface';

@Injectable()
export class MessageService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}/message`;

  private readonly SEND_MESSAGE_URL = `${this.apiUrl}/send`;
  private readonly GET_MESSAGES_URL = `${this.apiUrl}/conversation`;

  #activeMessages = signal<MessageI[]>([]);
  activeMessages = computed(this.#activeMessages);

  sendMessage(message: {
    sender: string;
    conversation: string;
    content: string;
    type: MessageType;
  }): Observable<MessageI> {
    return this.http.post<MessageI>(this.SEND_MESSAGE_URL, { message }).pipe(
      tap((newMessage) => {
        // Add new message to active messages
        this.#activeMessages.update((messages) => [newMessage, ...messages]);
      }),
      catchError((error) => {
        console.error('Error sending message:', error);
        return throwError(
          () => new Error(error.message || 'Failed to send message')
        );
      })
    );
  }

  // Get messages for a conversation
  getMessagesByConversationId(conversationId: string, offset = 0, limit = 20): Observable<MessageListI> {
    const url = `${this.GET_MESSAGES_URL}/${conversationId}/messages?offset=${offset}&limit=${limit}`;

    return this.http.get<MessageListI>(url).pipe(
      tap((messages) => {
        // Update active messages
        this.#activeMessages.update(val => [...val, ...messages.messages]);
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
    this.#activeMessages.update((messages) => [...messages, message]);
  }

  // Clear active messages (useful when changing conversations)
  clearActiveMessages(): void {
    this.#activeMessages.set([]);
  }
}

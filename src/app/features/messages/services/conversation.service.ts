import { inject, Injectable, signal } from '@angular/core';
import { Observable, Subject, tap } from 'rxjs';
import { WebSocketService } from './web-socket.service';
import { HttpClient } from '@angular/common/http';
import { ConversationI } from '../interfaces/conversation.interface';
import { environment } from '../../../../environments/environment';
import { ParticipantI } from '../interfaces/participant.interface';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}/conversations`;

  conversations = signal<ConversationI[]>([]);

  // Fetch all conversations for a user
  getConversations(userId: string): Observable<ConversationI[]> {
    return this.http
      .get<ConversationI[]>(`${this.apiUrl}?userId=${userId}`)
      .pipe(tap((res) => this.conversations.set(res)));
  }

  // Create a new conversation
  createConversation(participants: ParticipantI[]): Observable<ConversationI> {
    return this.http
      .post<ConversationI>(this.apiUrl, { participants })
      .pipe(tap((res) => this.conversations.update((val) => [res, ...val])));
  }

  // Get a specific conversation by ID
  getConversationById(conversationId: string): Observable<ConversationI> {
    return this.http.get<ConversationI>(`${this.apiUrl}/${conversationId}`);
  }

  // Add a participant to an existing conversation
  addParticipantToConversation(
    conversationId: string,
    participantId: string
  ): Observable<ConversationI> {
    return this.http.patch<ConversationI>(
      `${this.apiUrl}/${conversationId}/participants`,
      {
        participantId,
      }
    );
  }

  // Remove a participant from the conversation
  removeParticipantFromConversation(
    conversationId: string,
    participantId: string
  ): Observable<ConversationI> {
    return this.http.delete<ConversationI>(
      `${this.apiUrl}/${conversationId}/participants/${participantId}`
    );
  }
}

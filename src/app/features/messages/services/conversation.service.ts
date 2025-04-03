import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { ConversationI } from '../interfaces/conversation.interface';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}/message/conversation`;

  #conversations = signal<ConversationI[]>([]);
  conversations = computed<ConversationI[]>(this.#conversations);

  getConversations(): Observable<ConversationI[]> {
    return this.http
      .get<ConversationI[]>(this.apiUrl)
      .pipe(tap((res) => this.#conversations.set(res)));
  }

  searchConversations(query: string): Observable<ConversationI[]> {
    return this.http
      .get<ConversationI[]>(`${this.apiUrl}/search?q=${query}`)
      .pipe(tap((res) => this.#conversations.set(res)));
  }

  createConversation(conversation: ConversationI): Observable<ConversationI> {
    return this.http.post<ConversationI>(this.apiUrl, conversation);
  }

  updateConversation(conversation: ConversationI): Observable<ConversationI> {
    return this.http.post<ConversationI>(this.apiUrl, conversation);
  }
}

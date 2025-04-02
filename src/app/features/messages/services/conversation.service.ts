import { inject, Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}/message/conversation`;

  // #conversations = signal<ConversationI>(initialValue)

  constructor() {
    this.getConversations().subscribe();
  }

  getConversations(): Observable<any> {
    return this.http.get(this.apiUrl);
  }

  createConversation(userId: string, recipientId: string): Observable<any> {
    return this.http.post(this.apiUrl, { userId, recipientId });
  }

  getMessages(conversationId: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/${conversationId}/messages`);
  }

  markAsRead(conversationId: string, userId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${conversationId}/read`, { userId });
  }
}

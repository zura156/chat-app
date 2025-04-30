import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap, catchError, shareReplay, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ConversationI } from '../interfaces/conversation.interface';
import { MessageI } from '../interfaces/message.interface';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { UserI } from '../../../shared/interfaces/user.interface';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);

  private readonly apiUrl = environment.apiUrl;

  // API endpoints
  private readonly GET_CONVERSATIONS_URL = `${this.apiUrl}/message/conversation`;
  private readonly SEARCH_CONVERSATIONS_URL = `${this.apiUrl}/message/conversation/search`;
  private readonly CREATE_CONVERSATION_URL = `${this.apiUrl}/message/conversation`;
  private readonly GET_CONVERSATION_URL = `${this.apiUrl}/message/conversation`;

  // Cache for active conversation data (messages, etc.)
  #activeConversation = signal<ConversationI | null>(null);
  activeConversation = computed<ConversationI | null>(this.#activeConversation);

  #selectedUser = signal<UserI | null>(null);
  selectedUser = computed(this.#selectedUser);

  #conversationList = signal<ConversationListI | null>(null);
  conversationList = computed<ConversationListI | null>(this.#conversationList);

  selectUserForConversation(user: UserI): void {
    sessionStorage.setItem('selectedUser', JSON.stringify(user));
    this.#selectedUser.set(user);
  }

  // Get a single conversation with messages
  getConversationById(id: string): Observable<ConversationI> {
    const url = `${this.GET_CONVERSATION_URL}/${id}`;
    const data = this.activeConversation();

    if (data && data._id === id) {
      return of(data);
    }

    return this.http.get<ConversationI>(url).pipe(
      tap((data) => {
        this.#activeConversation.set(data);
      }),
      catchError((error) => {
        this.#activeConversation.set(null);
        return throwError(() => error);
      })
    );
  }

  // Get all conversations (inbox)
  getConversations(): Observable<ConversationListI> {
    return this.http.get<ConversationListI>(this.GET_CONVERSATIONS_URL).pipe(
      tap((data) => {
        this.#conversationList.set(data);
      }),
      catchError((error) => {
        this.#conversationList.set(null);
        throw error;
      })
    );
  }

  // Search conversations
  searchConversations(query: string): Observable<ConversationListI> {
    const url = `${this.SEARCH_CONVERSATIONS_URL}?q=${encodeURIComponent(
      query
    )}`;

    return this.http.get<ConversationListI>(url).pipe(
      tap((data) => {
        this.#conversationList.set(data);
      }),
      catchError((error) => {
        this.#conversationList.set(null);
        return throwError(() => error);
      })
    );
  }

  // create mock conversation for efficiency
  createMockConversation(): void {
    const selectedUser = this.selectedUser();
    if (selectedUser) {
      const mockConversation: ConversationI = {
        _id: selectedUser._id,
        participants: [selectedUser],
        is_group: false,
      };

      this.#activeConversation.set(mockConversation);
    }
  }

  // Create a new conversation
  createConversation(
    participants: string[],
    isGroup: boolean = false,
    groupName?: string
  ): Observable<ConversationI> {
    const payload = {
      participants,
      is_group: isGroup,
      group_name: groupName,
    };

    return this.http
      .post<ConversationI>(this.CREATE_CONVERSATION_URL, {
        conversation: payload,
      })
      .pipe(
        tap((newConversation) => {
          const conversationList = this.conversationList();
          if (conversationList && conversationList.conversations.length > 0) {
            this.#conversationList.update((val) => {
              val!.conversations = [newConversation, ...val!.conversations];
              return val;
            });
          }
        })
      );
  }
}

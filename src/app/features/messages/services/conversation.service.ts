import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ConversationI,
  ReadReceiptI,
} from '../interfaces/conversation.interface';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { UserI } from '../../user/interfaces/user.interface';
import { WebSocketService } from './web-socket.service';
import { ConversationJoinMessage } from '../interfaces/web-socket-message.interface';
import { UserService } from '../../user/services/user.service';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);
  private webSocketService = inject(WebSocketService);
  private userService = inject(UserService);

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
        read_receipts: [],
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
          this.#selectedUser.set(null);
          sessionStorage.removeItem('selectedUser');
          this.#activeConversation.set(newConversation);

          const currentUserId = this.userService.currentUser()?._id;

          for (let participant of newConversation.participants) {
            if (!currentUserId) continue;

            const conversationCreateMessage: ConversationJoinMessage = {
              type: 'conversation-join',
              conversation: { _id: newConversation._id },
              added_by: { _id: currentUserId },
              added_user: participant,
            };

            this.webSocketService.sendMessage(conversationCreateMessage);
          }

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

  addConversationToList(conversation: ConversationI): void {
    this.#conversationList.update((val) => {
      if (!val) return null;

      const newList = {
        conversations: [...val.conversations, conversation],
        totalCount: val.totalCount + 1,
      };
      return newList;
    });
  }

  removeConversationFromList(conversation: ConversationI): void {
    this.#conversationList.update((val) => {
      if (!val) return null;

      const newList = {
        conversations: val.conversations.filter(
          (c) => c._id !== conversation._id
        ),
        totalCount: val.totalCount - 1,
      };
      return newList;
    });
  }

  updateParticipantStatus(
    userId: string,
    status: 'offline' | 'online',
    last_seen: string
  ): void {
    this.#activeConversation.update((convo) => {
      if (convo?.participants) {
        return {
          ...convo,
          participants: convo.participants.map((participant) =>
            participant._id === userId
              ? { ...participant, status, last_seen }
              : participant
          ),
        };
      }
      return convo;
    });
  }

  updateReadReceipts(readReceipt: ReadReceiptI): void {
    this.#activeConversation.update((convo) => {
      if (!convo) return null;

      const existingReceiptIndex = convo.read_receipts.findIndex(
        (r) => r.user_id === readReceipt.user_id
      );
      const newReceipts = [...convo.read_receipts];

      if (existingReceiptIndex > -1) {
        newReceipts[existingReceiptIndex] = readReceipt;
      } else {
        newReceipts.push(readReceipt);
      }

      return { ...convo, read_receipts: newReceipts };
    });
  }
}

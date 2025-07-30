import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ConversationI,
  ReadReceiptI,
} from '../interfaces/conversation.interface';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { WebSocketService } from './web-socket.service';
import { ConversationJoinMessage } from '../interfaces/web-socket-message.interface';
import { UserService } from '../../user/services/user.service';
import { ParticipantI } from '../interfaces/participant.interface';
import { MemberChangesI } from '../interfaces/member-changes.interface';
import { ConversationIdResponseI } from '../interfaces/conversation-id-response.interface';
import { toast } from 'ngx-sonner';
import { UpdateConversationI } from '../interfaces/update-conversation.interface';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);
  private webSocketService = inject(WebSocketService);
  private userService = inject(UserService);

  private readonly apiUrl = environment.apiUrl;

  // API endpoints
  private readonly GET_CONVERSATIONS_URL = `${this.apiUrl}/conversations`;
  private readonly SEARCH_CONVERSATIONS_URL = `${this.apiUrl}/conversations/search`;
  private readonly FIND_CONVERSATION_ID_BY_USER_ID_URL = `${this.apiUrl}/conversations/find/:participantId`;
  private readonly CREATE_CONVERSATION_URL = `${this.apiUrl}/conversations`;
  private readonly GET_CONVERSATION_URL = `${this.apiUrl}/conversations/:id`;
  private readonly UPDATE_CONVERSATION_URL = `${this.apiUrl}/conversations/:id`;
  private readonly MANAGE_CONVERSATION_MEMBERS_URL = `${this.apiUrl}/conversations/:conversationId/members`;

  // Cache for active conversation data (messages, etc.)
  selectedConversationId = signal<string | null>(null);
  #activeConversation = signal<ConversationI | null>(null);
  activeConversation = computed<ConversationI | null>(this.#activeConversation);

  #selectedUser = signal<ParticipantI | null>(null);
  selectedUser = computed(this.#selectedUser);

  #conversationList = signal<ConversationListI | null>(null);
  conversationList = computed<ConversationListI | null>(this.#conversationList);

  selectUserForConversation(user: ParticipantI): void {
    sessionStorage.setItem('selectedUser', JSON.stringify(user));
    this.#selectedUser.set(user);
  }

  updateConversationState(conversation: ConversationI): void {
    if (!conversation || !conversation._id) {
      toast.error('Invalid conversation data received.');
      return;
    }
    if (this.selectedConversationId() === conversation._id) {
      this.#activeConversation.update(() => conversation);
    }

    this.#conversationList.update((prev) => {
      if (!prev) return null;

      const existingConversationIndex = prev.conversations.findIndex(
        (c) => c._id === conversation._id
      );

      if (existingConversationIndex > -1) {
        const updatedConversations = [...prev.conversations];
        updatedConversations[existingConversationIndex] = conversation;
        return { ...prev, conversations: updatedConversations };
      }

      return {
        ...prev,
        conversations: [conversation, ...prev.conversations],
      };
    });
  }

  // Get a single conversation with messages
  getConversationById(id: string): Observable<ConversationI> {
    const url = `${this.GET_CONVERSATION_URL.split(':id')[0]}${id}`;
    const data = this.activeConversation();

    if (data && data._id === id) {
      return of(data);
    }
    return this.http.get<ConversationI>(url).pipe(
      tap((data) => {
        this.selectedConversationId.set(data._id);
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

  findConversationIdByUserId(
    participant_id: string
  ): Observable<ConversationIdResponseI> {
    const url = `${
      this.FIND_CONVERSATION_ID_BY_USER_ID_URL.split(':participantId')[0]
    }${participant_id}`;

    return this.http.get<ConversationIdResponseI>(url);
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

  updateConversation(
    conversationId: string,
    updatedConversation: UpdateConversationI
  ): Observable<ConversationI> {
    const activeConversation = this.activeConversation();
    const { group_name: newGroupName, group_picture: newGroupPicture } =
      updatedConversation;

    if (!activeConversation) {
      toast.error('Conversation is not selected!', {
        description: 'No conversation means we can not update it :P',
      });
      return of();
    }
    if (!newGroupName && !newGroupPicture) {
      toast.error('Conversation not changed!', {
        description: 'Updated details were not provided.',
      });
      return of(activeConversation);
    }

    const url = `${
      this.UPDATE_CONVERSATION_URL.split(':id')[0]
    }${conversationId}`;
    const formData = new FormData();

    if (newGroupName) {
      formData.append('group_name', newGroupName);
    }
    if (newGroupPicture) {
      formData.append('group_picture', newGroupPicture);
    }

    return this.http.patch<ConversationI>(url, formData).pipe(
      tap((response) => {
        this.#activeConversation.update(() => response);

        this.#conversationList.update((prev) => ({
          totalCount: prev?.totalCount || 0,
          conversations:
            prev?.conversations.map((conv) =>
              conv._id === response._id ? response : conv
            ) ?? [],
        }));
      })
    );
  }

  addConversationToList(conversation: ConversationI): void {
    this.#conversationList.update((val) => {
      if (!val) return null;

      if (val.conversations.some((c) => c._id === conversation._id)) {
        return val;
      }

      const newList = {
        conversations: [conversation, ...val.conversations],
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

  manageConversationMembers(
    memberChanges: MemberChangesI,
    conversationId: string
  ): Observable<ConversationI> {
    const splitUrl =
      this.MANAGE_CONVERSATION_MEMBERS_URL.split(':conversationId');
    const url = `${splitUrl[0]}${conversationId}${splitUrl[1]}`;
    return this.http
      .patch<ConversationI>(url, memberChanges)
      .pipe(tap((res) => this.#activeConversation.set(res)));
  }
}

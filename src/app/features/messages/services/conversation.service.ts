import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap, catchError, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ConversationI,
  ReadReceiptI,
} from '../interfaces/conversation.interface';
import { ConversationListI } from '../interfaces/conversation-list.interface';
import { ParticipantI } from '../interfaces/participant.interface';
import { MemberChangesI } from '../interfaces/member-changes.interface';
import { ConversationIdResponseI } from '../interfaces/conversation-id-response.interface';
import { toast } from '@spartan-ng/brain/sonner';
import { UpdateConversationI } from '../interfaces/update-conversation.interface';
import { MessageI } from '../interfaces/message.interface';
import { UserStateService } from '../../user/services/user-state.service';
import { AuthService } from '../../auth/services/auth.service';

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);
  private userStateService = inject(UserStateService);
  private authService = inject(AuthService);

  private readonly apiUrl = environment.apiUrl;

  // API endpoints
  private readonly GET_CONVERSATIONS_URL = `${this.apiUrl}/conversations`;
  private readonly SEARCH_CONVERSATIONS_URL = `${this.apiUrl}/conversations/search`;
  private readonly FIND_CONVERSATION_ID_BY_USER_ID_URL = `${this.apiUrl}/conversations/find/:participantId`;
  private readonly CREATE_CONVERSATION_URL = `${this.apiUrl}/conversations`;
  private readonly MANAGE_CONVERSATION_MEMBERS_URL = `${this.apiUrl}/conversations/:conversationId/members`;

  // Cache for active conversation data (messages, etc.)
  selectedConversationId = signal<string | null>(null);
  #activeConversation = signal<ConversationI | null>(null);
  activeConversation = computed<ConversationI | null>(this.#activeConversation);

  selectedUser = this.userStateService.selectedUser;

  #conversationList = signal<ConversationListI | null>(null);
  conversationList = computed<ConversationListI | null>(this.#conversationList);

  /**
   * A locally-chosen group picture, shown before the server has one.
   *
   * Changing a group picture is not a direct write: the image is uploaded,
   * queued, resized by a worker and only then written to the conversation and
   * pushed back over the WebSocket. That is several seconds during which the
   * person who just picked a new picture saw the old one and nothing else —
   * which reads as "it didn't work", and is why the change appeared not to
   * happen in real time.
   *
   * Holding the cropped image here bridges that gap. It is deliberately kept
   * out of the conversation objects themselves so a data URL can never be
   * mistaken for a stored one, and it is dropped as soon as the real URL lands.
   */
  #pendingGroupPicture = signal<{ conversationId: string; dataUrl: string } | null>(
    null,
  );

  /** The optimistic picture for a conversation, if one is outstanding. */
  pendingGroupPictureFor(conversationId: string | undefined): string | null {
    const pending = this.#pendingGroupPicture();
    return pending && pending.conversationId === conversationId
      ? pending.dataUrl
      : null;
  }

  setPendingGroupPicture(conversationId: string, dataUrl: string): void {
    this.#pendingGroupPicture.set({ conversationId, dataUrl });
  }

  clearPendingGroupPicture(conversationId?: string): void {
    const pending = this.#pendingGroupPicture();
    if (!pending) return;
    if (conversationId && pending.conversationId !== conversationId) return;
    this.#pendingGroupPicture.set(null);
  }

  /**
   * Applies a finished group picture directly.
   *
   * The uploader's own `upload-ready` event carries the processed URL and the
   * conversation it belongs to, so their view no longer depends on the separate
   * `conversation-update` broadcast arriving — one missed event used to mean
   * the picture only showed up after a reload.
   */
  applyGroupPicture(conversationId: string, pictureUrl: string): void {
    if (!conversationId || !pictureUrl) return;

    this.clearPendingGroupPicture(conversationId);

    this.#activeConversation.update((c) =>
      c && c._id === conversationId ? { ...c, group_picture: pictureUrl } : c,
    );

    this.#conversationList.update((prev) =>
      prev
        ? {
            ...prev,
            conversations: prev.conversations.map((c) =>
              c._id === conversationId
                ? { ...c, group_picture: pictureUrl }
                : c,
            ),
          }
        : prev,
    );
  }

  constructor() {
    effect(() => {
      !this.authService.isAuthenticated() && this.reset();
    });
  }

  selectUserForConversation(user: ParticipantI): void {
    sessionStorage.setItem('selectedUser', JSON.stringify(user));
    this.userStateService.setSelectedUser(user);
  }

  updateConversationState(conversation: ConversationI): void {
    if (!conversation || !conversation._id) {
      toast.error('Invalid conversation data received.');
      return;
    }

    // The authoritative picture has arrived, so the optimistic one has done its
    // job. Left in place it would win over the real URL for the rest of the
    // session.
    if (conversation.group_picture) {
      this.clearPendingGroupPicture(conversation._id);
    }

    if (this.selectedConversationId() === conversation._id) {
      this.#activeConversation.update(() => conversation);
    }

    this.#conversationList.update((prev) => {
      if (!prev) return null;

      const existingConversationIndex = prev.conversations.findIndex(
        (c) => c._id === conversation._id,
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
    const url = `${this.apiUrl}/conversations/${id}`;
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
      }),
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
      }),
    );
  }

  // Search conversations
  searchConversations(query: string): Observable<ConversationListI> {
    const url = `${this.SEARCH_CONVERSATIONS_URL}?q=${encodeURIComponent(
      query,
    )}`;

    return this.http.get<ConversationListI>(url).pipe(
      tap((data) => {
        this.#conversationList.set(data);
      }),
      catchError((error) => {
        this.#conversationList.set(null);
        return throwError(() => error);
      }),
    );
  }

  findConversationIdByUserId(
    participant_id: string,
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
    groupName?: string,
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
          this.userStateService.setSelectedUser(null);
          sessionStorage.removeItem('selectedUser');
          this.#activeConversation.set(newConversation);
          // must return a NEW object — mutating and returning the same
          // reference means the signal never notifies its consumers
          this.#conversationList.update((prev) =>
            prev
              ? {
                  ...prev,
                  conversations: [newConversation, ...prev.conversations],
                  totalCount: prev.totalCount + 1,
                }
              : prev,
          );
        }),
      );
  }

  updateConversation(
    conversationId: string,
    updatedConversation: UpdateConversationI,
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

    const url = `${this.apiUrl}/conversations/${conversationId}`;

    // JSON, not FormData: the API has no multipart parser mounted, so a
    // multipart body arrives as an empty req.body
    const body: Record<string, string> = {};
    if (newGroupName) body['group_name'] = newGroupName;
    if (newGroupPicture) body['group_picture'] = newGroupPicture;

    return this.http.patch<ConversationI>(url, body).pipe(
      tap((response) => {
        this.#activeConversation.update(() => response);

        this.#conversationList.update((prev) => ({
          totalCount: prev?.totalCount || 0,
          conversations:
            prev?.conversations.map((c) =>
              c._id === response._id ? response : c,
            ) ?? [],
        }));
      }),
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

  setLastMessageInConversation(
    conversationId: string,
    message: MessageI,
  ): void {
    this.#conversationList.update((val) => {
      if (!val) return null;

      return {
        ...val,
        conversations: val.conversations.map((c) =>
          c._id === conversationId && message
            ? { ...c, last_message: message }
            : c,
        ),
      };
    });
  }

  /**
   * Idempotent, because it is genuinely called twice for one removal.
   *
   * The chatbox and the conversation list both handle `conversation-leave`, and
   * whenever a conversation is open both are mounted — so a single leave ran
   * this twice. Filtering is naturally idempotent and hid it; the counter was
   * not, and dropped by two. `totalCount` only comes back from the server on a
   * full reload, so the drift accumulated across a session and there was
   * nothing to correct it.
   *
   * Mirrors `addConversationToList`, which already refuses to count a
   * conversation it can see is present.
   */
  removeConversationFromList(conversation: ConversationI): void {
    this.#conversationList.update((val) => {
      if (!val) return null;

      const conversations = val.conversations.filter(
        (c) => c._id !== conversation._id,
      );
      if (conversations.length === val.conversations.length) return val;

      return {
        conversations,
        totalCount: Math.max(0, val.totalCount - 1),
      };
    });
  }

  updateParticipantStatus(
    userId: string,
    status: 'offline' | 'online',
    last_seen: string,
  ): void {
    this.#activeConversation.update((c) => {
      if (c?.participants) {
        return {
          ...c,
          participants: c.participants.map((participant) =>
            participant._id === userId
              ? { ...participant, status, last_seen }
              : participant,
          ),
        };
      }
      return c;
    });
  }

  updateReadReceipts(readReceipt: ReadReceiptI): void {
    this.#activeConversation.update((c) => {
      if (!c) return null;

      const existingReceiptIndex = c.read_receipts.findIndex(
        (r) => r.user_id === readReceipt.user_id,
      );
      const newReceipts = [...c.read_receipts];

      if (existingReceiptIndex > -1) {
        newReceipts[existingReceiptIndex] = readReceipt;
      } else {
        newReceipts.push(readReceipt);
      }

      return { ...c, read_receipts: newReceipts };
    });

    this.#conversationList.update((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        conversations: prev.conversations.map((c) => {
          if (c._id !== this.selectedConversationId()) return c;
          const idx = c.read_receipts.findIndex(
            (r) => r.user_id === readReceipt.user_id,
          );
          const receipts = [...c.read_receipts];
          if (idx > -1) receipts[idx] = readReceipt;
          else receipts.push(readReceipt);
          return { ...c, read_receipts: receipts };
        }),
      };
    });
  }

  manageConversationMembers(
    memberChanges: MemberChangesI,
    conversationId: string,
  ): Observable<ConversationI> {
    const splitUrl =
      this.MANAGE_CONVERSATION_MEMBERS_URL.split(':conversationId');
    const url = `${splitUrl[0]}${conversationId}${splitUrl[1]}`;
    return this.http.patch<ConversationI>(url, memberChanges).pipe(
      tap((res) => {
        this.#conversationList.update((prev) => {
          if (!prev) return null;

          return {
            ...prev,
            conversations: prev.conversations.map((c) =>
              c._id === res._id ? res : c,
            ),
          };
        });
        this.#activeConversation.set(res);
      }),
    );
  }

  reset(): void {
    this.selectedConversationId.set(null);
    this.#activeConversation.set(null);
    this.#conversationList.set(null);
  }
}

import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient, httpResource } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AttachmentI,
  MessageI,
  MessageStatus,
} from '../interfaces/message.interface';
import { MessageListI } from '../interfaces/message-list.interface';
import { ConversationService } from './conversation.service';
import { WebSocketService } from './web-socket.service';
import { MessageStatusMessage } from '../interfaces/web-socket-message.interface';
import { UserStateService } from '../../user/services/user-state.service';
import { AuthService } from '../../auth/services/auth.service';

/**
 * Merge a freshly fetched page into what is already on screen.
 * Keyed by `_id`, falling back to `tempId` so optimistic messages that have no
 * server id yet survive a page load instead of silently disappearing.
 */
function mergeMessagePage(
  previous: MessageI[],
  incoming: MessageI[],
): MessageI[] {
  const byKey = new Map<string, MessageI>();
  for (const msg of [...previous, ...incoming]) {
    const key = msg._id ?? msg.tempId;
    if (key) byKey.set(key, msg);
  }
  return Array.from(byKey.values());
}

@Injectable()
export class MessageService {
  private http = inject(HttpClient);
  private conversationService = inject(ConversationService);
  private userStateService = inject(UserStateService);
  private webSocketService = inject(WebSocketService);
  private authService = inject(AuthService);

  private apiUrl = `${environment.apiUrl}/messages`;

  previousConversationId = signal<string | null>(null);

  // state management for all messages
  messageOffset = signal<number>(0);
  messageLimit = signal<number>(20);
  hasMoreMessages = linkedSignal<boolean>(() => {
    const totalCount = this.totalMessagesCount();
    if (totalCount === undefined) {
      return false;
    }
    return this.messageOffset() + this.messageLimit() < totalCount;
  });

  // state management for media messages
  mediaMessageOffset = signal<number>(0);
  mediaMessageLimit = signal<number>(20);
  hasMoreMediaMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeMediaMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.mediaMessageOffset() + this.mediaMessageLimit() < totalCount;
  });

  // state management for file messages
  fileMessageOffset = signal<number>(0);
  fileMessageLimit = signal<number>(20);
  hasMoreFileMessages = linkedSignal<boolean>(() => {
    const totalCount = this.activeFileMessagesResource.value()?.totalCount;
    if (totalCount === undefined) {
      return false;
    }

    return this.fileMessageOffset() + this.fileMessageLimit() < totalCount;
  });

  // signals for message management
  #activeMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeMessagesResource.value() || { messages: [], totalCount: 0 },
    computation: (newResource, previous) => {
      const conversation = this.conversationService.activeConversation();
      const previousMessages = previous?.value ?? [];

      if (!conversation || !conversation._id || !newResource) {
        return [];
      }

      const isInitialLoad = previousMessages.length === 0;
      const isDifferentConversation =
        !isInitialLoad &&
        previousMessages[0]?.conversation !== conversation._id;

      if (isInitialLoad || isDifferentConversation) {
        return newResource.messages;
      }

      return mergeMessagePage(previousMessages, newResource.messages);
    },
  });

  activeMessages: Signal<MessageI[]> = computed<MessageI[]>(() => {
    return this.#activeMessages();
  });

  #totalMessagesCount: WritableSignal<number> = linkedSignal<number>(() => {
    const totalCount = this.activeMessagesResource.value()?.totalCount;

    return totalCount || 0;
  });
  totalMessagesCount: Signal<number> = computed<number>(
    this.#totalMessagesCount,
  );

  #activeMediaMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeMediaMessagesResource.value() || {
        messages: [],
        totalCount: 0,
      },
    computation: (newResource, previous) => {
      const conversation = this.conversationService.activeConversation();
      const previousMessages = previous?.value ?? [];

      if (!conversation || !conversation._id || !newResource) {
        return [];
      }

      const isInitialLoad = previousMessages.length === 0;
      const isDifferentConversation =
        !isInitialLoad &&
        previousMessages[0]?.conversation !== conversation._id;

      if (isInitialLoad || isDifferentConversation) {
        return newResource.messages;
      }

      return mergeMessagePage(previousMessages, newResource.messages);
    },
  });

  activeMediaMessages: Signal<MessageI[]> = computed<MessageI[]>(
    this.#activeMediaMessages,
  );

  #totalMediaMessagesCount: WritableSignal<number> = linkedSignal<number>(
    () => {
      const totalCount = this.activeMediaMessagesResource.value()?.totalCount;

      return totalCount || 0;
    },
  );
  totalMediaMessagesCount: Signal<number> = computed<number>(
    this.#totalMediaMessagesCount,
  );

  #activeFileMessages = linkedSignal<MessageListI, MessageI[]>({
    source: () =>
      this.activeFileMessagesResource.value() || {
        messages: [],
        totalCount: 0,
      },
    computation: (newResource, previous) => {
      const conversation = this.conversationService.activeConversation();
      const previousMessages = previous?.value ?? [];

      if (!conversation || !conversation._id || !newResource) {
        return [];
      }

      const isInitialLoad = previousMessages.length === 0;
      const isDifferentConversation =
        !isInitialLoad &&
        previousMessages[0]?.conversation !== conversation._id;

      if (isInitialLoad || isDifferentConversation) {
        return newResource.messages;
      }

      return mergeMessagePage(previousMessages, newResource.messages);
    },
  });

  activeFileMessages: Signal<MessageI[]> = computed<MessageI[]>(
    this.#activeFileMessages,
  );

  #totalFileMessagesCount: WritableSignal<number> = linkedSignal<number>(() => {
    const totalCount = this.activeFileMessagesResource.value()?.totalCount;

    return totalCount || 0;
  });
  totalFileMessagesCount: Signal<number> = computed<number>(
    this.#totalFileMessagesCount,
  );

  // Control signals for on-demand fetching
  private shouldFetchMediaMessages = signal<boolean>(false);
  private shouldFetchFileMessages = signal<boolean>(false);

  constructor() {
    effect(() => {
      !this.authService.isAuthenticated() && this.reset();
    });
  }

  activeMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();

    if (
      !conversationId ||
      conversationId === this.userStateService.selectedUser()?._id
    ) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/messages?offset=${this.messageOffset()}&limit=${this.messageLimit()}`;
    return url;
  });

  activeMediaMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchMediaMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/media?offset=${this.mediaMessageOffset()}&limit=${this.mediaMessageLimit()}`;
    return url;
  });

  activeFileMessagesResource = httpResource<MessageListI>(() => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchFileMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    const url = `${
      this.apiUrl
    }/${conversationId}/files?offset=${this.fileMessageOffset()}&limit=${this.fileMessageLimit()}`;
    return url;
  });

  // Public methods to trigger media/file message fetching from components
  fetchMediaMessages(): void {
    this.shouldFetchMediaMessages.set(true);
  }

  fetchFileMessages(): void {
    this.shouldFetchFileMessages.set(true);
  }

  // Method to load more media messages
  loadMoreMediaMessages(): void {
    if (this.hasMoreMediaMessages()) {
      this.mediaMessageOffset.update(
        (offset) => offset + this.mediaMessageLimit(),
      );
    }
  }

  // Method to load more file messages
  loadMoreFileMessages(): void {
    if (this.hasMoreFileMessages()) {
      this.fileMessageOffset.update(
        (offset) => offset + this.fileMessageLimit(),
      );
    }
  }

  // Methods to reset fetching state (useful when changing conversations)
  resetMediaMessagesFetch(): void {
    this.shouldFetchMediaMessages.set(false);
    this.mediaMessageOffset.set(0);
    this.#activeMediaMessages.set([]);
  }

  resetFileMessagesFetch(): void {
    this.shouldFetchFileMessages.set(false);
    this.fileMessageOffset.set(0);
    this.#activeFileMessages.set([]);
  }

  sendMessage(
    conversationId: string,
    content: string | null,
    attachments: {
      uploadId: string;
      context: string;
      mimeType: string;
      fileSize: number;
      originalName?: string;
    }[],
    tempId: string,
  ): Observable<MessageI> {
    return this.http.post<MessageI>(`${this.apiUrl}/${conversationId}/send`, {
      content,
      attachments,
      tempId,
    });
  }

  // update attachment variants when worker finishes
  updateAttachmentVariants(
    uploadId: string,
    variants: Record<string, string>,
    duration?: number,
  ): void {
    this.#activeMessages.update((messages) =>
      messages.map((msg) => {
        const idx =
          msg.attachments?.findIndex((a) => a.uploadId === uploadId) ?? -1;
        if (idx === -1) return msg;
        const updatedAttachments = [...(msg.attachments ?? [])];
        updatedAttachments[idx] = {
          ...updatedAttachments[idx],
          status: 'ready',
          variants,
          ...(duration !== undefined && { duration }),
        };
        return { ...msg, attachments: updatedAttachments };
      }),
    );
  }

  markAttachmentInfected(uploadId: string): void {
    this.setAttachmentStatus(uploadId, 'infected');
  }

  markAttachmentFailed(uploadId: string): void {
    this.setAttachmentStatus(uploadId, 'failed');
  }

  private setAttachmentStatus(
    uploadId: string,
    status: AttachmentI['status'],
  ): void {
    this.#activeMessages.update((messages) =>
      messages.map((msg) => {
        const idx =
          msg.attachments?.findIndex((a) => a.uploadId === uploadId) ?? -1;
        if (idx === -1) return msg;
        const updatedAttachments = [...(msg.attachments ?? [])];
        updatedAttachments[idx] = { ...updatedAttachments[idx], status };
        return { ...msg, attachments: updatedAttachments };
      }),
    );
  }

  markMessageAsRead(lastMessageId: string) {
    if (!lastMessageId) return;

    const user = this.userStateService.currentUser();
    const message = this.findMessageById(lastMessageId);
    if (!user || !message) return;

    const currentUserId = user._id;
    const conversation = this.conversationService.activeConversation();

    if (!currentUserId || !conversation?._id) return;

    if (
      conversation &&
      conversation.read_receipts.find((r) => r.user_id === currentUserId)
        ?.last_message_read_id === lastMessageId
    ) {
      return;
    }

    // Then send to server via websocket
    const readData: MessageStatusMessage = {
      type: 'message-status',
      read_receipt: {
        last_message_read_id: lastMessageId,
        read_at: new Date(),
        user_id: currentUserId,
      },
      conversation_id: conversation._id,
      status: 'read',
    };

    this.webSocketService.sendMessage(readData);
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
  addMessage(message: MessageI): void {
    this.#activeMessages.update((currentMessages) => {
      // guard against the same message being pushed twice (e.g. a websocket
      // redelivery after a reconnect)
      const exists = currentMessages.some(
        (m) =>
          (!!message._id && m._id === message._id) ||
          (!!message.tempId && m.tempId === message.tempId),
      );
      return exists ? currentMessages : [message, ...currentMessages];
    });

    const prependOnce = (list: MessageI[]): MessageI[] =>
      list.some((m) => !!message._id && m._id === message._id)
        ? list
        : [message, ...list];

    if (message?.type === 'image' || message?.type === 'video') {
      this.#activeMediaMessages.update(prependOnce);
    } else if (message?.type === 'file') {
      this.#activeFileMessages.update(prependOnce);
    }
  }

  // Clear active messages (useful when changing conversations)
  clearActiveMessages(): void {
    this.#activeMessages.set([]);
  }

  /**
   * Reconcile one sent message with what is on screen.
   *
   * A message the current user sends arrives twice: once over the websocket
   * (carries `tempId`) and once as the REST response (carries `_id` only).
   * Depending on which wins the race there can be *two* entries to collapse —
   * the optimistic bubble matched by `tempId` and an already-inserted copy
   * matched by `_id`. Merge into the first match and drop the rest, so the
   * operation is idempotent no matter the arrival order.
   */
  fillInMessageDetails(message: MessageI): void {
    this.#activeMessages.update((messages) => {
      const isSame = (m: MessageI): boolean =>
        (!!message.tempId && m.tempId === message.tempId) ||
        (!!message._id && m._id === message._id);

      const next: MessageI[] = [];
      let merged = false;

      for (const m of messages) {
        if (!isSame(m)) {
          next.push(m);
          continue;
        }
        if (merged) continue; // duplicate of one we already merged — drop it

        next.push({
          ...m,
          ...message,
          // keep the temp id so a later echo still recognizes this entry
          tempId: m.tempId ?? message.tempId,
          status: message.status ?? MessageStatus.SENT,
        });
        merged = true;
      }

      if (merged) return next;

      // Sent from another device of the same user: only insert it if it
      // actually belongs to the thread on screen, otherwise a message sent to
      // conversation B shows up inside conversation A.
      return this.belongsToActiveConversation(message)
        ? [message, ...messages]
        : messages;
    });
  }

  private belongsToActiveConversation(message: MessageI): boolean {
    const activeId = this.conversationService.activeConversation()?._id;
    if (!activeId) return false;

    const conversationId =
      typeof message.conversation === 'string'
        ? message.conversation
        : message.conversation?._id;

    return conversationId === activeId;
  }

  /** Optimistic message could not be delivered — surface it instead of hanging. */
  markMessageFailed(tempId: string): void {
    this.#activeMessages.update((messages) =>
      messages.map((m) =>
        m.tempId === tempId ? { ...m, status: MessageStatus.FAILED } : m,
      ),
    );
  }

  private findMessageById(messageId: string): MessageI | undefined {
    const message = this.activeMessages().find((m) => m._id === messageId);
    if (message) {
      return message;
    }

    return undefined;
  }

  reset(): void {
    this.#activeMessages.set([]);
    this.#activeMediaMessages.set([]);
    this.#activeFileMessages.set([]);
    this.#totalMessagesCount.set(0);
    this.#totalMediaMessagesCount.set(0);
    this.#totalFileMessagesCount.set(0);
    this.messageOffset.set(0);
    this.mediaMessageOffset.set(0);
    this.fileMessageOffset.set(0);
    this.shouldFetchMediaMessages.set(false);
    this.shouldFetchFileMessages.set(false);
    this.previousConversationId.set(null);
  }
}

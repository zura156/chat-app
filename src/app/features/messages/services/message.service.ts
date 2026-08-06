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
import { Observable, tap } from 'rxjs';
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

/** Newest first — the order the thread is rendered and paginated in. */
export const byNewestFirst = (a: MessageI, b: MessageI): number =>
  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

/**
 * Merge a freshly fetched page into what is already on screen.
 *
 * Keyed by `_id`, falling back to `tempId` so optimistic messages that have no
 * server id yet survive a page load instead of silently disappearing.
 *
 * The result is sorted rather than left in insertion order. It used to rely on
 * pages arriving strictly oldest-last and new messages always being prepended,
 * which happens to hold on the common path and silently does not the moment
 * anything arrives out of order — a websocket redelivery after a reconnect, or
 * a message landing while an older page is in flight. The thread would then
 * stay scrambled for the rest of the session, and `groupedMessages` (which
 * assumes descending order to find time gaps) would draw its dividers in the
 * wrong places.
 */
export function mergeMessagePage(
  previous: MessageI[],
  incoming: MessageI[],
): MessageI[] {
  const byKey = new Map<string, MessageI>();
  for (const msg of [...previous, ...incoming]) {
    const key = msg._id ?? msg.tempId;
    if (key) byKey.set(key, msg);
  }
  return Array.from(byKey.values()).sort(byNewestFirst);
}

/** The paging inputs a list reads, declared before the resource that uses them. */
interface Paging {
  offset: WritableSignal<number>;
  limit: WritableSignal<number>;
}

const paging = (limit = 20): Paging => ({
  offset: signal(0),
  limit: signal(limit),
});

/**
 * One conversation-scoped, paginated message list.
 *
 * The service held three of these — all messages, media only, files only — as
 * three verbatim copies of the same six declarations: an offset, a limit, a
 * `hasMore` linkedSignal, a `linkedSignal` with an identical 25-line merge
 * computation, a total count, and a readonly projection. Around two hundred
 * lines that had to be kept in step by hand.
 */
class MessageList {
  readonly offset: WritableSignal<number>;
  readonly limit: WritableSignal<number>;

  private readonly items: WritableSignal<MessageI[]>;
  private readonly total: WritableSignal<number>;

  readonly value: Signal<MessageI[]>;
  readonly totalCount: Signal<number>;
  readonly hasMore: Signal<boolean>;

  constructor(
    page: Paging,
    private readonly resource: { value: () => MessageListI | undefined },
    private readonly activeConversationId: () => string | undefined,
  ) {
    this.offset = page.offset;
    this.limit = page.limit;

    this.items = linkedSignal<MessageListI, MessageI[]>({
      source: () => this.resource.value() ?? { messages: [], totalCount: 0 },
      computation: (fetched, previous) => {
        const conversationId = this.activeConversationId();
        const previousMessages = previous?.value ?? [];

        if (!conversationId || !fetched) return [];

        const isInitialLoad = previousMessages.length === 0;
        const isDifferentConversation =
          !isInitialLoad &&
          previousMessages[0]?.conversation !== conversationId;

        if (isInitialLoad || isDifferentConversation) {
          return [...fetched.messages].sort(byNewestFirst);
        }

        return mergeMessagePage(previousMessages, fetched.messages);
      },
    });

    this.total = linkedSignal(() => this.resource.value()?.totalCount ?? 0);

    this.value = this.items.asReadonly();
    this.totalCount = this.total.asReadonly();
    this.hasMore = computed(
      () => this.offset() + this.limit() < this.totalCount(),
    );
  }

  update(fn: (messages: MessageI[]) => MessageI[]): void {
    this.items.update(fn);
  }

  set(messages: MessageI[]): void {
    this.items.set(messages);
  }

  loadMore(): void {
    if (this.hasMore()) this.offset.update((o) => o + this.limit());
  }

  reset(): void {
    this.items.set([]);
    this.total.set(0);
    this.offset.set(0);
  }
}

@Injectable()
export class MessageService {
  private http = inject(HttpClient);
  private conversationService = inject(ConversationService);
  private userStateService = inject(UserStateService);
  private webSocketService = inject(WebSocketService);
  private authService = inject(AuthService);

  private apiUrl = `${environment.apiUrl}/messages`;

  /**
   * Which conversation the media/file panels were last loaded for. Owned here
   * because the resources below read it; the chatbox writes it when a
   * conversation change has been fully applied.
   */
  previousConversationId = signal<string | null>(null);

  // Control signals for on-demand fetching

  private shouldFetchMediaMessages = signal<boolean>(false);
  private shouldFetchFileMessages = signal<boolean>(false);

  /*
   * Paging is declared ahead of the resources because the resource URLs read
   * it. (Field initialisers run in order, so a list that owned its own paging
   * could not be constructed before the resource that depends on it.)
   */
  private readonly messagePaging = paging();
  private readonly mediaPaging = paging();
  private readonly filePaging = paging();

  readonly messageOffset = this.messagePaging.offset;
  readonly messageLimit = this.messagePaging.limit;
  readonly mediaMessageOffset = this.mediaPaging.offset;
  readonly mediaMessageLimit = this.mediaPaging.limit;
  readonly fileMessageOffset = this.filePaging.offset;
  readonly fileMessageLimit = this.filePaging.limit;

  constructor() {
    // Signing out must not leave another account's thread in memory.
    effect(() => {
      if (!this.authService.isAuthenticated()) this.reset();
    });
  }

  activeMessagesResource = httpResource<MessageListI>((): string | undefined => {
    const conversationId = this.conversationService.selectedConversationId();

    if (
      !conversationId ||
      conversationId === this.userStateService.selectedUser()?._id
    ) {
      return;
    }

    return `${this.apiUrl}/${conversationId}/messages?offset=${this.messageOffset()}&limit=${this.messageLimit()}`;
  });

  activeMediaMessagesResource = httpResource<MessageListI>((): string | undefined => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchMediaMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    return `${this.apiUrl}/${conversationId}/media?offset=${this.mediaMessageOffset()}&limit=${this.mediaMessageLimit()}`;
  });

  activeFileMessagesResource = httpResource<MessageListI>((): string | undefined => {
    const conversationId = this.conversationService.selectedConversationId();
    const shouldFetch = this.shouldFetchFileMessages();

    if (!conversationId || !shouldFetch) {
      return;
    }

    const prevId = this.previousConversationId();
    if (prevId && prevId !== conversationId) {
      return;
    }

    return `${this.apiUrl}/${conversationId}/files?offset=${this.fileMessageOffset()}&limit=${this.fileMessageLimit()}`;
  });

  /*
   * Three instances of the same thing, instead of three hand-maintained copies
   * of it. See MessageList above.
   */
  private readonly conversationId = (): string | undefined =>
    this.conversationService.activeConversation()?._id;

  private readonly messages = new MessageList(
    this.messagePaging,
    this.activeMessagesResource,
    this.conversationId,
  );
  private readonly media = new MessageList(
    this.mediaPaging,
    this.activeMediaMessagesResource,
    this.conversationId,
  );
  private readonly files = new MessageList(
    this.filePaging,
    this.activeFileMessagesResource,
    this.conversationId,
  );

  // ── Public surface (unchanged shape, single implementation behind it) ───────

  readonly activeMessages = this.messages.value;
  readonly totalMessagesCount = this.messages.totalCount;
  readonly hasMoreMessages = this.messages.hasMore;

  readonly activeMediaMessages = this.media.value;
  readonly totalMediaMessagesCount = this.media.totalCount;
  readonly hasMoreMediaMessages = this.media.hasMore;

  readonly activeFileMessages = this.files.value;
  readonly totalFileMessagesCount = this.files.totalCount;
  readonly hasMoreFileMessages = this.files.hasMore;

  // Public methods to trigger media/file message fetching from components
  fetchMediaMessages(): void {
    this.shouldFetchMediaMessages.set(true);
  }

  fetchFileMessages(): void {
    this.shouldFetchFileMessages.set(true);
  }

  loadMoreMediaMessages(): void {
    this.media.loadMore();
  }

  loadMoreFileMessages(): void {
    this.files.loadMore();
  }

  // Methods to reset fetching state (useful when changing conversations)
  resetMediaMessagesFetch(): void {
    this.shouldFetchMediaMessages.set(false);
    this.media.reset();
  }

  resetFileMessagesFetch(): void {
    this.shouldFetchFileMessages.set(false);
    this.files.reset();
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
    this.messages.update((messages) =>
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
    this.messages.update((messages) =>
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
    this.messages.update((messages) => {
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
    this.messages.update((currentMessages) => {
      // guard against the same message being pushed twice (e.g. a websocket
      // redelivery after a reconnect)
      const exists = currentMessages.some(
        (m) =>
          (!!message._id && m._id === message._id) ||
          (!!message.tempId && m.tempId === message.tempId),
      );
      // Sorted rather than blindly prepended: a message that arrives late (a
      // websocket redelivery, or one that raced a page load) is not necessarily
      // the newest, and inserting it at the front would leave the thread out of
      // order for the rest of the session.
      return exists
        ? currentMessages
        : [message, ...currentMessages].sort(byNewestFirst);
    });

    const prependOnce = (list: MessageI[]): MessageI[] =>
      list.some((m) => !!message._id && m._id === message._id)
        ? list
        : [message, ...list].sort(byNewestFirst);

    if (message?.type === 'image' || message?.type === 'video') {
      this.media.update(prependOnce);
    } else if (message?.type === 'file') {
      this.files.update(prependOnce);
    }
  }

  editMessage(conversationId: string, messageId: string, content: string) {
    return this.http
      .patch<MessageI>(
        `${this.apiUrl}/${conversationId}/messages/${messageId}`,
        { content },
      )
      .pipe(tap((message) => this.applyEdited(message)));
  }

  deleteMessage(conversationId: string, messageId: string) {
    return this.http
      .delete<{ _id: string; deleted_at: string }>(
        `${this.apiUrl}/${conversationId}/messages/${messageId}`,
      )
      .pipe(tap((res) => this.applyDeleted(res._id, res.deleted_at)));
  }

  /** Replaces an edited message in place, keeping its position in the thread. */
  applyEdited(edited: MessageI): void {
    this.messages.update((messages) =>
      messages.map((message) =>
        message._id === edited._id ? { ...message, ...edited } : message,
      ),
    );
  }

  /**
   * Empties a message rather than removing it: the bubble stays as a tombstone,
   * matching the server's soft delete, and removing it would leave a gap where
   * another user's read receipt still points.
   */
  applyDeleted(messageId: string, deletedAt: string): void {
    const strip = (list: MessageI[]): MessageI[] =>
      list.map((message) =>
        message._id === messageId
          ? {
              ...message,
              content: null,
              attachments: [],
              deleted_at: deletedAt,
            }
          : message,
      );

    this.messages.update(strip);
    // Deleted media must also leave the media and file panels.
    this.media.update((list) =>
      list.filter((m) => m._id !== messageId),
    );
    this.files.update((list) =>
      list.filter((m) => m._id !== messageId),
    );
  }

  // Clear active messages (useful when changing conversations)
  clearActiveMessages(): void {
    this.messages.set([]);
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
    this.messages.update((messages) => {
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
        ? [message, ...messages].sort(byNewestFirst)
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
    this.messages.update((messages) =>
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
    this.messages.reset();
    this.media.reset();
    this.files.reset();
    this.shouldFetchMediaMessages.set(false);
    this.shouldFetchFileMessages.set(false);
    this.previousConversationId.set(null);
  }
}

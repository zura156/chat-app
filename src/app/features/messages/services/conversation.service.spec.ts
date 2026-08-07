import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationService } from './conversation.service';
import { UserStateService } from '../../user/services/user-state.service';
import { AuthService } from '../../auth/services/auth.service';
import { ConversationI } from '../interfaces/conversation.interface';
import {
  MessageI,
  MessageStatus,
  MessageType,
} from '../interfaces/message.interface';
import { environment } from '../../../../environments/environment';

/*
 * The in-memory conversation list, which is the only copy the UI reads between
 * full reloads.
 *
 * `totalCount` comes from the server once, on load, and is then maintained by
 * hand as conversations are created, joined and left. That makes every mutation
 * here a chance to drift, with nothing to correct it until the next reload —
 * and the drift is invisible, because the visible list is derived from the
 * array rather than the count.
 *
 * The specific failure these were written for: the chatbox and the conversation
 * list both handle `conversation-leave`, and whenever a conversation is open
 * both components are mounted, so one leave removed one conversation and
 * decremented the counter twice.
 */

const conversation = (id: string, over: Partial<ConversationI> = {}) =>
  ({
    _id: id,
    participants: [],
    is_group: true,
    group_name: `Group ${id}`,
    read_receipts: [],
    ...over,
  }) as ConversationI;

describe('ConversationService — the conversation list', () => {
  let service: ConversationService;
  let http: HttpTestingController;

  const listUrl = `${environment.apiUrl}/conversations`;

  /** Loads a list of `n` conversations, the way a real session starts. */
  const load = (ids: string[], totalCount = ids.length) => {
    service.getConversations().subscribe();
    http.expectOne(listUrl).flush({
      conversations: ids.map((id) => conversation(id)),
      totalCount,
    });
  };

  const state = () => service.conversationList()!;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ConversationService,
        {
          provide: UserStateService,
          useValue: { selectedUser: signal(null), setSelectedUser: vi.fn() },
        },
        { provide: AuthService, useValue: { isAuthenticated: signal(true) } },
      ],
    });

    service = TestBed.inject(ConversationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('removing', () => {
    it('removes the conversation and decrements the count', () => {
      load(['a', 'b', 'c']);

      service.removeConversationFromList(conversation('b'));

      expect(state().conversations.map((c) => c._id)).toEqual(['a', 'c']);
      expect(state().totalCount).toBe(2);
    });

    it('counts one removal once, however many times it is told', () => {
      /*
       * The regression. Both the chatbox and the list act on the same
       * `conversation-leave` event, so this is the ordinary case rather than a
       * contrived one.
       */
      load(['a', 'b', 'c']);

      service.removeConversationFromList(conversation('b'));
      service.removeConversationFromList(conversation('b'));

      expect(state().conversations.map((c) => c._id)).toEqual(['a', 'c']);
      expect(state().totalCount).toBe(2);
    });

    it('ignores a conversation that was never in the list', () => {
      // A leave event can arrive for a conversation this client never loaded —
      // it is only holding the first page.
      load(['a', 'b'], 40);

      service.removeConversationFromList(conversation('not-loaded'));

      expect(state().totalCount).toBe(40);
      expect(state().conversations).toHaveLength(2);
    });

    it('never reports a negative count', () => {
      // Whatever else drifts, a negative total is nonsense that reads as
      // truthy everywhere it is checked.
      load(['a'], 1);

      service.removeConversationFromList(conversation('a'));
      service.removeConversationFromList(conversation('a'));

      expect(state().totalCount).toBe(0);
    });

    it('keeps the total above the number loaded, when more exist', () => {
      // The list is paginated: totalCount describes the server's count, not the
      // page in memory, so removing one must not collapse it to the page size.
      load(['a', 'b'], 40);

      service.removeConversationFromList(conversation('a'));

      expect(state().totalCount).toBe(39);
      expect(state().conversations).toHaveLength(1);
    });

    it('does nothing when no list has been loaded', () => {
      expect(() =>
        service.removeConversationFromList(conversation('a')),
      ).not.toThrow();
      expect(service.conversationList()).toBeNull();
    });
  });

  describe('adding', () => {
    it('adds to the front and increments', () => {
      // Newest first: a conversation someone just started belongs at the top.
      load(['a', 'b']);

      service.addConversationToList(conversation('new'));

      expect(state().conversations.map((c) => c._id)).toEqual([
        'new',
        'a',
        'b',
      ]);
      expect(state().totalCount).toBe(3);
    });

    it('counts one addition once', () => {
      // Same double-delivery shape as the leave event.
      load(['a']);

      service.addConversationToList(conversation('new'));
      service.addConversationToList(conversation('new'));

      expect(state().conversations).toHaveLength(2);
      expect(state().totalCount).toBe(2);
    });
  });

  describe('add and remove together', () => {
    it('returns to the count it started with', () => {
      // The property that matters over a long session: the counter tracks the
      // list rather than the number of events that happened to arrive.
      load(['a', 'b', 'c']);

      service.addConversationToList(conversation('d'));
      service.removeConversationFromList(conversation('d'));
      service.removeConversationFromList(conversation('d'));
      service.addConversationToList(conversation('a'));

      expect(state().conversations.map((c) => c._id)).toEqual(['a', 'b', 'c']);
      expect(state().totalCount).toBe(3);
    });
  });

  describe('updating an entry', () => {
    it('replaces in place without changing the count', () => {
      load(['a', 'b']);

      service.updateConversationState(conversation('b', { group_name: 'Renamed' }));

      expect(state().totalCount).toBe(2);
      expect(state().conversations.find((c) => c._id === 'b')?.group_name).toBe(
        'Renamed',
      );
    });

    it('inserts a conversation it has not seen before', () => {
      // Being added to a group arrives as an update for something not in the
      // list yet.
      load(['a']);

      service.updateConversationState(conversation('b'));

      expect(state().conversations.map((c) => c._id)).toEqual(['b', 'a']);
    });
  });

  describe('the last message on a card', () => {
    /*
     * The sidebar keeps its own copy of `last_message`, so an edit or a delete
     * that only reached the open thread left the card showing text the sender
     * had already taken back — visible for as long as the session lasted,
     * because nothing else rewrites that copy until the conversation next moves.
     */
    const withLastMessage = (id: string, message: Partial<MessageI>) =>
      conversation(id, {
        last_message: {
          _id: `msg-${id}`,
          sender: {},
          conversation: id,
          type: MessageType.IMAGE,
          status: MessageStatus.SENT,
          timestamp: new Date().toISOString(),
          ...message,
        } as MessageI,
      });

    const loadWith = (conversations: ConversationI[]) => {
      service.getConversations().subscribe();
      http
        .expectOne(listUrl)
        .flush({ conversations, totalCount: conversations.length });
    };

    it('empties a deleted last message instead of leaving it whole', () => {
      loadWith([
        withLastMessage('a', {
          content: 'the secret',
          attachments: [{ uploadId: 'u1' } as any],
          edited_at: new Date().toISOString(),
        }),
      ]);

      service.applyDeletedToLastMessage('msg-a', '2026-01-01T00:00:00.000Z');

      const last = state().conversations[0].last_message!;
      expect(last.content).toBeNull();
      expect(last.attachments).toEqual([]);
      expect(last.deleted_at).toBe('2026-01-01T00:00:00.000Z');
      // The two the card reads to caption a contentless message. Left alone,
      // the row goes on advertising "📷 Photo" for a message that is gone.
      expect(last.type).toBe(MessageType.TEXT);
      expect(last.edited_at).toBeUndefined();
    });

    it('leaves other conversations alone', () => {
      loadWith([
        withLastMessage('a', { content: 'mine' }),
        withLastMessage('b', { content: 'theirs' }),
      ]);

      service.applyDeletedToLastMessage('msg-a', '2026-01-01T00:00:00.000Z');

      expect(state().conversations[1].last_message!.content).toBe('theirs');
    });

    it('ignores a delete further back in the thread', () => {
      // Only the newest message is on the card; deleting an older one must not
      // blank it.
      loadWith([withLastMessage('a', { content: 'still the newest' })]);

      service.applyDeletedToLastMessage('some-older-message', 'whenever');

      expect(state().conversations[0].last_message!.content).toBe(
        'still the newest',
      );
    });

    it('updates the text of an edited last message', () => {
      loadWith([withLastMessage('a', { content: 'before' })]);

      service.applyEditedToLastMessage({
        _id: 'msg-a',
        content: 'after',
        edited_at: '2026-01-01T00:00:00.000Z',
      } as MessageI);

      expect(state().conversations[0].last_message!.content).toBe('after');
    });
  });

  describe('signing out', () => {
    it('drops the list entirely', () => {
      // Another account's conversations must not survive in memory.
      load(['a', 'b']);

      service.reset();

      expect(service.conversationList()).toBeNull();
      expect(service.activeConversation()).toBeNull();
      expect(service.selectedConversationId()).toBeNull();
    });
  });
});

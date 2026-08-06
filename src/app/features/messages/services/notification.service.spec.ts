import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';
import { WebSocketService } from './web-socket.service';
import { environment } from '../../../../environments/environment';
import { NotificationMessage } from '../interfaces/web-socket-message.interface';

/*
 * Unread badges.
 *
 * The tricky part is not the arithmetic, it is the race: a message arriving in
 * the conversation the user is looking at raises a `notification` event *and*
 * is cleared by the read receipt the chatbox sends — and both are
 * fire-and-forget, so the increment can land after the clear. The service
 * decides locally rather than trusting arrival order, and that decision is what
 * these pin down. Get it wrong and the badge on the chat you are reading counts
 * up, which is the exact symptom this logic was written to fix.
 */

@Component({ template: '' })
class BlankComponent {}

const CONVERSATION_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const CONVERSATION_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const notify = (
  conversationId: string,
  unread_count: number,
  seen = false,
): NotificationMessage => ({
  type: 'notification',
  conversationId,
  unread_count,
  seen,
});

describe('NotificationService', () => {
  let service: NotificationService;
  let http: HttpTestingController;
  let socket$: Subject<NotificationMessage>;
  let router: Router;

  /** Created lazily, so a test can navigate before the service reads the URL. */
  const start = (): NotificationService => {
    service = TestBed.inject(NotificationService);
    return service;
  };

  beforeEach(() => {
    socket$ = new Subject<NotificationMessage>();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'messages', component: BlankComponent },
          { path: 'messages/new', component: BlankComponent },
          { path: 'messages/:id', component: BlankComponent },
        ]),
        NotificationService,
        {
          provide: WebSocketService,
          useValue: {
            onMessageOfType: <T>() =>
              socket$.asObservable() as unknown as Observable<T>,
          },
        },
      ],
    });

    router = TestBed.inject(Router);
    // The service suppresses badges for the chat on screen only when the tab
    // is actually visible; jsdom reports 'prerender' by default.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const injectHttp = () => (http = TestBed.inject(HttpTestingController));

  describe('counts', () => {
    beforeEach(() => {
      injectHttp();
      start();
    });

    it('starts empty', () => {
      expect(service.notifications()).toEqual([]);
      expect(service.totalUnread()).toBe(0);
    });

    it('seeds counts from the server', () => {
      service.load().subscribe();
      http.expectOne(`${environment.apiUrl}/notifications`).flush({
        notifications: [
          {
            _id: '1',
            conversation: { _id: CONVERSATION_A },
            unread_count: 3,
            seen: false,
          },
          {
            _id: '2',
            conversation: { _id: CONVERSATION_B },
            unread_count: 1,
            seen: false,
          },
        ],
      });

      expect(service.totalUnread()).toBe(4);
      expect(service.unreadFor(CONVERSATION_A)).toBe(3);
    });

    it('excludes rows already marked seen from the total', () => {
      service.load().subscribe();
      http.expectOne(`${environment.apiUrl}/notifications`).flush({
        notifications: [
          {
            _id: '1',
            conversation: { _id: CONVERSATION_A },
            unread_count: 3,
            seen: true,
          },
          {
            _id: '2',
            conversation: { _id: CONVERSATION_B },
            unread_count: 2,
            seen: false,
          },
        ],
      });

      // A seen row keeps its count for the server's benefit; the badge must not.
      expect(service.totalUnread()).toBe(2);
      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
    });

    it('accepts a conversation as a bare id as well as an object', () => {
      // The REST payload populates `conversation`; the websocket event sends
      // only the id. Both end up in the same list.
      service.load().subscribe();
      http.expectOne(`${environment.apiUrl}/notifications`).flush({
        notifications: [
          { _id: '1', conversation: CONVERSATION_A, unread_count: 5, seen: false },
        ],
      });

      expect(service.unreadFor(CONVERSATION_A)).toBe(5);
    });

    it('returns zero for a conversation it knows nothing about', () => {
      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
      expect(service.unreadFor(undefined)).toBe(0);
    });

    it('swallows a failed load rather than killing the caller', () => {
      service.load().subscribe();
      http
        .expectOne(`${environment.apiUrl}/notifications`)
        .error(new ProgressEvent('network'));

      expect(service.notifications()).toEqual([]);
    });
  });

  describe('realtime events', () => {
    beforeEach(async () => {
      injectHttp();
      // Somewhere that is not a conversation, so nothing is suppressed.
      await router.navigateByUrl('/messages');
      start();
    });

    it('adds a conversation it has never seen', () => {
      socket$.next(notify(CONVERSATION_A, 1));
      expect(service.unreadFor(CONVERSATION_A)).toBe(1);
      expect(service.totalUnread()).toBe(1);
    });

    it('upserts rather than appending a duplicate row', () => {
      socket$.next(notify(CONVERSATION_A, 1));
      socket$.next(notify(CONVERSATION_A, 2));

      expect(service.notifications()).toHaveLength(1);
      expect(service.unreadFor(CONVERSATION_A)).toBe(2);
    });

    it('ignores an event carrying no conversation', () => {
      socket$.next(notify('', 4));
      expect(service.notifications()).toHaveLength(0);
    });

    it('drops everything on reset, for a sign-out', () => {
      socket$.next(notify(CONVERSATION_A, 3));
      service.reset();

      expect(service.notifications()).toEqual([]);
      expect(service.totalUnread()).toBe(0);
    });
  });

  describe('the conversation on screen', () => {
    beforeEach(() => injectHttp());

    it('never raises a badge for the chat being read', async () => {
      await router.navigateByUrl(`/messages/${CONVERSATION_A}`);
      start();

      // The server will clear this a round trip later, but the two are both
      // fire-and-forget — deciding locally is what makes the badge correct
      // regardless of which one wins.
      socket$.next(notify(CONVERSATION_A, 7));

      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
      expect(service.totalUnread()).toBe(0);
    });

    it('still counts other conversations while one is open', async () => {
      await router.navigateByUrl(`/messages/${CONVERSATION_A}`);
      start();

      socket$.next(notify(CONVERSATION_B, 2));
      expect(service.unreadFor(CONVERSATION_B)).toBe(2);
    });

    it('counts messages for the open chat when the tab is hidden', async () => {
      // Nobody is reading a backgrounded tab; swallowing these would leave no
      // trace of what was missed.
      await router.navigateByUrl(`/messages/${CONVERSATION_A}`);
      start();
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

      socket$.next(notify(CONVERSATION_A, 3));
      expect(service.unreadFor(CONVERSATION_A)).toBe(3);
    });

    it('follows navigation between conversations', async () => {
      await router.navigateByUrl(`/messages/${CONVERSATION_A}`);
      start();

      await router.navigateByUrl(`/messages/${CONVERSATION_B}`);

      socket$.next(notify(CONVERSATION_A, 4)); // no longer on screen
      socket$.next(notify(CONVERSATION_B, 4)); // now on screen

      expect(service.unreadFor(CONVERSATION_A)).toBe(4);
      expect(service.unreadFor(CONVERSATION_B)).toBe(0);
    });

    it('treats /messages/new as no conversation at all', async () => {
      // It is the compose screen; "new" is not an id and must not suppress a
      // real conversation's badge.
      await router.navigateByUrl('/messages/new');
      start();

      socket$.next(notify(CONVERSATION_A, 5));
      expect(service.unreadFor(CONVERSATION_A)).toBe(5);
    });
  });

  describe('markSeen', () => {
    const seenUrl = `${environment.apiUrl}/notifications/seen`;

    beforeEach(async () => {
      injectHttp();
      await router.navigateByUrl('/messages');
      start();
    });

    it('clears the badge locally before the server confirms', () => {
      socket$.next(notify(CONVERSATION_A, 4));
      service.markSeen(CONVERSATION_A);

      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
      http.expectOne(seenUrl).flush({ ok: true });
    });

    it('still sends the clear for a conversation with no row yet', () => {
      /*
       * The previous check also skipped when the row was *absent*, which
       * silently dropped the clear whenever a chat was opened before the
       * initial load() resolved — the counts then arrived for a conversation
       * already on screen.
       */
      service.markSeen(CONVERSATION_A);
      http.expectOne(seenUrl).flush({ ok: true });
    });

    it('does not send a clear for a row that is already clear', () => {
      socket$.next(notify(CONVERSATION_A, 0, true));
      service.markSeen(CONVERSATION_A);
      http.expectNone(seenUrl);
    });

    it('ignores an empty conversation id', () => {
      service.markSeen('');
      http.expectNone(seenUrl);
    });

    it('re-applies the clear once the server answers', () => {
      socket$.next(notify(CONVERSATION_A, 4));
      service.markSeen(CONVERSATION_A);

      // A load() still in flight can resolve after markSeen and restore the
      // stale count, so the clear is applied again on confirmation.
      socket$.next(notify(CONVERSATION_A, 9));
      http.expectOne(seenUrl).flush({ ok: true });

      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
    });

    it('keeps the local clear when the request fails', () => {
      socket$.next(notify(CONVERSATION_A, 4));
      service.markSeen(CONVERSATION_A);
      http.expectOne(seenUrl).error(new ProgressEvent('network'));

      // The badge is a cache and the next load corrects it; flashing the count
      // back on a transient failure is worse than being briefly optimistic.
      expect(service.unreadFor(CONVERSATION_A)).toBe(0);
    });
  });
});

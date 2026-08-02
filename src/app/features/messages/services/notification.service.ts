import { Service, signal, computed, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { catchError, EMPTY, filter, tap } from 'rxjs';
import { NotificationI } from '../interfaces/notification.interface';
import { NotificationMessage } from '../interfaces/web-socket-message.interface';
import { WebSocketService } from './web-socket.service';
import { environment } from '../../../../environments/environment';

@Service()
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly webSocketService = inject(WebSocketService);
  private readonly router = inject(Router);
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  /** Conversation currently on screen, read straight off the URL. */
  private readonly activeConversationId = signal<string | null>(null);

  private readonly _notifications = signal<NotificationI[]>([]);
  readonly notifications = this._notifications.asReadonly();

  /** Unread messages across every conversation, ignoring ones already seen. */
  readonly totalUnread = computed(() =>
    this._notifications()
      .filter((notification) => !notification.seen)
      .reduce((sum, notification) => sum + (notification.unread_count || 0), 0),
  );

  /**
   * Built once per notification change rather than scanned per card — every
   * conversation card reads this, so an O(n) find each would be O(n²) on every
   * incoming message.
   */
  private readonly unreadByConversation = computed(() => {
    const counts = new Map<string, number>();
    for (const notification of this._notifications()) {
      if (notification.seen) continue;
      const conversationId = this.conversationIdOf(notification);
      if (conversationId) {
        counts.set(conversationId, notification.unread_count || 0);
      }
    }
    return counts;
  });

  constructor() {
    // Subscribed here rather than in a component: the badges live on the
    // conversation list, and on mobile that is the one route where the chatbox
    // — the previous home of this handler — is not mounted.
    this.webSocketService
      .onMessageOfType<NotificationMessage>('notification')
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.handleRealtimeNotification(message));

    this.activeConversationId.set(this.conversationIdFromUrl(this.router.url));
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((event) =>
        this.activeConversationId.set(
          this.conversationIdFromUrl(event.urlAfterRedirects),
        ),
      );
  }

  /** `/messages/<id>` — `new` is the compose screen, not a conversation. */
  private conversationIdFromUrl(url: string): string | null {
    const id = /^\/messages\/([^/?#]+)/.exec(url)?.[1];
    return !id || id === 'new' ? null : id;
  }

  /** Unread messages in one conversation. Call from a reactive context. */
  unreadFor(conversationId: string | undefined): number {
    if (!conversationId) return 0;
    return this.unreadByConversation().get(conversationId) ?? 0;
  }

  private conversationIdOf(notification: NotificationI): string | undefined {
    const conversation = notification.conversation as
      { _id?: string } | string | undefined;
    return typeof conversation === 'string' ? conversation : conversation?._id;
  }

  load() {
    return this.http.get<{ notifications: NotificationI[] }>(this.apiUrl).pipe(
      tap((response) => this._notifications.set(response?.notifications ?? [])),
      catchError(() => EMPTY),
    );
  }

  /** Websocket `notification` event — upsert, keyed by conversation. */
  private handleRealtimeNotification(message: NotificationMessage): void {
    const { conversationId } = message;
    if (!conversationId) return;

    /*
     * A message arriving in the conversation the user is looking at is read on
     * arrival, so it must never raise a badge. The server agrees — the read
     * receipt the chatbox sends clears the counter — but that is a full round
     * trip behind this event, and both are fire-and-forget, so the increment
     * can land after the clear. Deciding it locally makes the badge correct
     * regardless of which one wins.
     *
     * Visibility matters: with the tab in the background nobody is reading, and
     * silently swallowing those would leave no trace of what was missed.
     */
    const isReading =
      conversationId === this.activeConversationId() &&
      document.visibilityState === 'visible';

    const unread_count = isReading ? 0 : message.unread_count;
    const seen = isReading ? true : message.seen;

    this._notifications.update((notifications) => {
      const index = notifications.findIndex(
        (notification) =>
          this.conversationIdOf(notification) === conversationId,
      );

      if (index === -1) {
        return [
          {
            _id: conversationId,
            conversation: { _id: conversationId },
            unread_count,
            seen,
          } as NotificationI,
          ...notifications,
        ];
      }

      const next = [...notifications];
      next[index] = { ...next[index], unread_count, seen };
      return next;
    });
  }

  /**
   * Clear the badge for one conversation. Applied locally first so opening a
   * chat feels immediate; the request only persists it.
   */
  markSeen(conversationId: string): void {
    if (!conversationId) return;

    const existing = this._notifications().find(
      (notification) => this.conversationIdOf(notification) === conversationId,
    );

    /*
     * Skip the request only when the conversation is present and already clear.
     * The previous check also skipped when it was *absent*, which silently
     * dropped the clear whenever a conversation was opened before the initial
     * load() resolved — the counts then arrived for a chat already on screen.
     */
    if (existing && existing.seen && existing.unread_count === 0) return;

    this.applyLocalClear(conversationId);

    this.http
      .patch(`${this.apiUrl}/seen`, { conversationId })
      .pipe(catchError(() => EMPTY))
      // A load() still in flight can resolve after this and restore the stale
      // count, so re-apply once the server has confirmed.
      .subscribe(() => this.applyLocalClear(conversationId));
  }

  private applyLocalClear(conversationId: string): void {
    this._notifications.update((notifications) =>
      notifications.map((notification) =>
        this.conversationIdOf(notification) === conversationId
          ? { ...notification, unread_count: 0, seen: true }
          : notification,
      ),
    );
  }

  reset(): void {
    this._notifications.set([]);
  }
}

import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, EMPTY, tap } from 'rxjs';
import { NotificationI } from '../interfaces/notification.interface';
import { NotificationMessage } from '../interfaces/web-socket-message.interface';
import { environment } from '../../../../environments/environment';

@Service()
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  private readonly _notifications = signal<NotificationI[]>([]);
  readonly notifications = this._notifications.asReadonly();

  /** Unread messages across every conversation, ignoring ones already seen. */
  readonly totalUnread = computed(() =>
    this._notifications()
      .filter((notification) => !notification.seen)
      .reduce((sum, notification) => sum + (notification.unread_count || 0), 0),
  );

  private conversationIdOf(notification: NotificationI): string | undefined {
    const conversation = notification.conversation as
      | { _id?: string }
      | string
      | undefined;
    return typeof conversation === 'string' ? conversation : conversation?._id;
  }

  load() {
    return this.http.get<{ notifications: NotificationI[] }>(this.apiUrl).pipe(
      tap((response) => this._notifications.set(response?.notifications ?? [])),
      catchError(() => EMPTY),
    );
  }

  /** Websocket `notification` event — upsert, keyed by conversation. */
  handleRealtimeNotification(message: NotificationMessage): void {
    const { conversationId, unread_count, seen } = message;
    if (!conversationId) return;

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

    const alreadyClear = !this._notifications().some(
      (notification) =>
        this.conversationIdOf(notification) === conversationId &&
        !notification.seen &&
        notification.unread_count > 0,
    );
    if (alreadyClear) return;

    this._notifications.update((notifications) =>
      notifications.map((notification) =>
        this.conversationIdOf(notification) === conversationId
          ? { ...notification, unread_count: 0, seen: true }
          : notification,
      ),
    );

    this.http
      .patch(`${this.apiUrl}/seen`, { conversationId })
      .pipe(catchError(() => EMPTY))
      .subscribe();
  }

  reset(): void {
    this._notifications.set([]);
  }
}

import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NotificationI } from '../interfaces/notification.interface';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private _notifications = signal<NotificationI[]>([]);

  private readonly apiUrl = environment.apiUrl;

  private readonly LOAD_NOTIFICATIONS_URL = `${this.apiUrl}/notifications`;

  notifications = this._notifications.asReadonly();

  // Total unseen count for global bell
  totalUnread = computed(() =>
    this._notifications().reduce(
      (sum, n) => sum + (n.seen ? 0 : n.unread_count),
      0,
    ),
  );

  // Per-conversation badge lookup
  unreadForConversation = (conversationId: string) =>
    computed(
      () =>
        this._notifications().find((n) => n.conversation._id === conversationId)
          ?.unread_count ?? 0,
    );

  constructor(private http: HttpClient) {}

  loadNotifications(): void {
    this.http
      .get<{ notifications: NotificationI[] }>(this.LOAD_NOTIFICATIONS_URL)
      .subscribe({
        next: ({ notifications }) => this._notifications.set(notifications),
        error: (err) => console.error('Failed to load notifications', err),
      });
  }

  // Called by WebSocket service on incoming 'notification' message
  handleRealtimeNotification(data: {
    conversationId: string;
    unread_count: number;
    seen: boolean;
  }): void {
    this._notifications.update((notifications) => {
      const idx = notifications.findIndex(
        (n) => n.conversation._id === data.conversationId,
      );
      if (idx === -1) {
        // New notification not yet in list — reload from REST to get full shape
        this.loadNotifications();
        return notifications;
      }
      const updated = [...notifications];
      updated[idx] = {
        ...updated[idx],
        unread_count: data.unread_count,
        seen: data.seen,
      };
      return updated;
    });

    // Browser push notification
    this.showBrowserNotification(data.conversationId);
  }

  markAsSeen(conversationId: string): void {
    this.http.patch('/api/notifications/seen', { conversationId }).subscribe({
      next: () => {
        this._notifications.update((notifications) =>
          notifications.map((n) =>
            n.conversation._id === conversationId
              ? { ...n, seen: true, unread_count: 0 }
              : n,
          ),
        );
      },
    });
  }

  private async showBrowserNotification(conversationId: string): Promise<void> {
    if (Notification.permission !== 'granted') return;
    const notif = this._notifications().find(
      (n) => n.conversation._id === conversationId,
    );
    if (!notif) return;
    const title = notif.conversation.group_name ?? 'New message';
    new Notification(title, {
      body: `${notif.unread_count} unread message(s)`,
      icon: '/favicon.ico',
    });
  }
}

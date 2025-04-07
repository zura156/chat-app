import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { NotificationI } from '../interfaces/notification.interface';

@Injectable()
export class NotificationService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // API endpoints
  private readonly GET_NOTIFICATIONS_URL = `${this.apiUrl}/notifications`;
  private readonly MARK_AS_READ_URL = `${this.apiUrl}/notifications`;

  // Signals
  #notifications = signal<NotificationI[]>([]);
  notifications = this.#notifications.asReadonly();

  #unreadCount = signal<number>(0);
  unreadCount = this.#unreadCount.asReadonly();

  // Get user notifications
  getNotifications(): Observable<NotificationI[]> {
    return this.http.get<NotificationI[]>(this.GET_NOTIFICATIONS_URL).pipe(
      tap((notifications) => {
        this.#notifications.set(notifications);
        this.#unreadCount.set(notifications.filter((n) => !n.isRead).length);
      }),
      catchError((error) => {
        console.error('Error fetching notifications:', error);
        return throwError(
          () => new Error(error.message || 'Failed to fetch notifications')
        );
      })
    );
  }

  // Mark notification as read
  markAsRead(notificationId: string): Observable<NotificationI> {
    const url = `${this.MARK_AS_READ_URL}/${notificationId}/read`;

    return this.http.post<NotificationI>(url, {}).pipe(
      tap(() => {
        // Update local state
        this.#notifications.update((notifications) =>
          notifications.map((n) =>
            n._id === notificationId ? { ...n, isRead: true } : n
          )
        );
        this.#unreadCount.update((count) => Math.max(0, count - 1));
      }),
      catchError((error) => {
        console.error('Error marking notification as read:', error);
        return throwError(
          () =>
            new Error(error.message || 'Failed to mark notification as read')
        );
      })
    );
  }

  // Mark all notifications as read
  markAllAsRead(): Observable<any> {
    const url = `${this.MARK_AS_READ_URL}/read-all`;

    return this.http.post(url, {}).pipe(
      tap(() => {
        // Update local state
        this.#notifications.update((notifications) =>
          notifications.map((n) => ({ ...n, isRead: true }))
        );
        this.#unreadCount.set(0);
      }),
      catchError((error) => {
        console.error('Error marking all notifications as read:', error);
        return throwError(
          () =>
            new Error(
              error.message || 'Failed to mark all notifications as read'
            )
        );
      })
    );
  }

  // Add a single notification (useful for real-time updates)
  addNotification(notification: NotificationI): void {
    this.#notifications.update((notifications) => [
      notification,
      ...notifications,
    ]);
    if (!notification.isRead) {
      this.#unreadCount.update((count) => count + 1);
    }
  }
}

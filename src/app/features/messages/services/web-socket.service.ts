import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import { WebSocketMessageT } from '../interfaces/web-socket-message.interface';
import { catchError, EMPTY, Observable, share, Subject } from 'rxjs';
import { toast } from 'ngx-sonner';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket$?: WebSocketSubject<WebSocketMessageT>;
  private readonly messagesSubject = new Subject<WebSocketMessageT>();

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  // In WebSocketService
  connect(userId: string): void {
    if (!userId) return;

    if (this.socket$ && !this.socket$.closed) {
      return; // Already connected
    }

    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket({
        url: environment.wsUrl,
        openObserver: {
          next: () => {
            this.reconnectAttempts = 0;
            this.socket$?.next({
              type: 'authenticate',
              user_id: userId,
            });
          },
        },
        closeObserver: {
          next: () => this.handleReconnect(userId),
        },
      });

      this.socket$
        .pipe(
          catchError((error) => {
            console.error('WebSocket error:', error);
            toast.error('Connection error');
            return EMPTY;
          }),
          share(),
        )
        .subscribe({
          next: (msg) => this.messagesSubject.next(msg),
          error: (err) => console.error('WebSocket stream error: ', err),
        });
    }
  }

  sendMessage(data: WebSocketMessageT): void {
    this.socket$?.next(data);
  }

  onMessage(): Observable<WebSocketMessageT> {
    return this.messagesSubject.asObservable();
  }

  close(): void {
    this.messagesSubject.complete();
    this.socket$?.complete();
  }

  private handleReconnect(userId: string): void {
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(userId), 2000 * this.reconnectAttempts);
    } else {
      toast.error('Failed to reconnect. Please refresh.');
    }
  }
}

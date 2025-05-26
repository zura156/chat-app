import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import { WebSocketMessageT } from '../interfaces/web-socket-message.interface';
import { tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket$?: WebSocketSubject<WebSocketMessageT>;

  // In WebSocketService
  connect(userId: string): void {
    if (!userId) {
      console.error('Cannot connect: No user ID provided');
      return;
    }

    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket({
        url: environment.wsUrl,
        openObserver: {
          next: () => {
            // Register the user immediately after connection
            this.socket$?.next({
              type: 'authenticate',
              userId: userId,
            });
          },
        },
      });
      this.socket$.subscribe();
    }
  }

  sendMessage(data: WebSocketMessageT) {
    if (this.socket$) {
      this.socket$?.next(data);
    }
  }

  onMessage() {
    return this.socket$;
  }

  close() {
    if (this.socket$) {
      this.socket$?.complete();
    }
  }
}

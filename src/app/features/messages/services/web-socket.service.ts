import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import { WebSocketMessageT } from '../interfaces/web-socket-message.interface';
import { of } from 'rxjs';
import { toast } from 'ngx-sonner';

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
              user_id: userId,
            });
          },
        },
      });
      this.socket$.subscribe();
    }
  }

  sendMessage(data: WebSocketMessageT): void {
    if (this.socket$) {
      this.socket$?.next(data);
    }
  }

  onMessage(): WebSocketSubject<WebSocketMessageT> {
    if (!this.socket$) {
      toast.error('Failed to establish a connection with WebSocketServer.');
      return new WebSocketSubject<WebSocketMessageT>(
        of({
          type: 'error',
          message: 'Failed to establish a connection with WebSocketServer.',
        })
      );
    }
    return this.socket$;
  }

  close(): void {
    if (this.socket$) {
      this.socket$?.complete();
    }
  }
}

import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import { ParticipantI } from '../interfaces/participant.interface';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket$?: WebSocketSubject<{
    _id?: string;
    type: string;
    to?: string[] | string;
    sender?: Partial<ParticipantI>;
    message?: string;
    conversation?: string;
    userId?: string;
    content?: string;
  }>;

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
              type: 'register',
              userId: userId,
            });
          },
        },
      });
      this.socket$.subscribe();
    }
  }

  sendMessage(data: {
    _id: string;
    type: string;
    to: string[] | string;
    sender: Partial<ParticipantI>;
    message: string;
    conversation: string;
  }) {
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

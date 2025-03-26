import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';
import { MessageI } from '../interfaces/message.interface';
import { WebSocketMessageI } from '../interfaces/web-socket-message.interface';

@Injectable()
export class MessageService {
  private authService = inject(AuthService);

  private socket: WebSocket | null = null;
  private messageSubject = new Subject<MessageI>();
  private connectionSubject = new BehaviorSubject<boolean>(false);

  public messages$ = this.messageSubject.asObservable();
  public isConnected$ = this.connectionSubject.asObservable();

  connect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(environment.wsUrl);

    this.socket.onopen = () => {
      console.log('WebSocket connection established');
      this.authenticate();
      this.connectionSubject.next(true);
    };

    this.socket.onmessage = (event) => {
      const data: WebSocketMessageI = event.data;

      switch (data.type) {
        case 'new_message':
          if (data.message) {
            this.messageSubject.next(data.message);
          }
          break;
        case 'authenticate':
          console.log('WebSocket authentication status:', data);
          break;
      }
    };

    this.socket.onclose = () => {
      console.log('WebSocket connection closed');
      this.connectionSubject.next(false);

      // Attempt to reconnect
      setTimeout(() => this.connect(), 3000);
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.connectionSubject.next(false);
    };
  }

  private authenticate(): void {
    const token = this.authService.accessToken;

    if (token && this.socket) {
      this.socket.send(
        JSON.stringify({
          type: 'authenticate',
          token: token,
        })
      );
    }
  }

  sendMessage(conversationId: string, content: string): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(
        JSON.stringify({
          type: 'send_message',
          conversationId,
          content,
        })
      );
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

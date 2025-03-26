import { Injectable } from '@angular/core';
import { webSocket } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { MessageI } from '../interfaces/message.interface';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket$ = webSocket(environment.wsUrl);

  sendMessage(message: MessageI): void {
    this.socket$.next(message);
  }

  getMessages(): Observable<MessageI[]> {
    return this.socket$.asObservable() as Observable<MessageI[]>;
  }

  closeConnection(): void {
    this.socket$.complete();
  }
}

import { Injectable } from '@angular/core';
import { WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private socket$: WebSocketSubject<any>;

  constructor() {
    this.socket$ = new WebSocketSubject(environment.wsUrl);
  }

  sendMessage(data: any) {
    this.socket$.next(data);
  }

  onMessage() {
    return this.socket$;
  }

  close() {
    this.socket$.complete();
  }
}

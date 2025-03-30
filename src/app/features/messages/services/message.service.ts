import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()
export class MessageService {
  private http = inject(HttpClient);

  private apiUrl = `${environment.apiUrl}/messages`;

  sendMessage(from: string, to: string, message: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/send`, { from, to, message });
  }
}

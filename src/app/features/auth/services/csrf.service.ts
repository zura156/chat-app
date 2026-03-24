import { inject, Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { MessageResponseI } from '../../../shared/interfaces/message-response.interface';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class CSRFService {
  private readonly apiUrl = environment.apiUrl;

  private readonly GET_CSRF_TOKEN_URL = `${this.apiUrl}/auth/csrf-token`;

  private http = inject(HttpClient);

  getTokenFromCookie(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  getCsrfToken(): Observable<MessageResponseI> {
    return this.http.get<MessageResponseI>(this.GET_CSRF_TOKEN_URL);
  }
}

import { inject, Injectable } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  http = inject(HttpClient);

  private readonly _LOGIN_URL = `${environment.apiUrl}/auth/login`;
  private readonly _REGISTER_URL = `${environment.apiUrl}/auth/register`;

  login(credentials: { username: string; password: string }): Observable<any> {
    return this.http.post(this._LOGIN_URL, credentials);
  }

  register(credentials: { username: string; email: string; password: string }) {
    return this.http.post(this._REGISTER_URL, credentials);
  }
}

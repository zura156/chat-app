import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { UserI } from '../../../shared/interfaces/user.interface';
import { Observable, tap } from 'rxjs';
import { UserListI } from '../../../shared/interfaces/user-list.interface';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);

  private readonly apiUrl = environment.apiUrl;

  private readonly _GET_CURRENT_USER_URL = `${this.apiUrl}/user/profile`;
  private readonly _GET_USERS_URL = `${this.apiUrl}/user`;
  private readonly _SEARCH_USERS_URL = `${this.apiUrl}/user/search`;

  currentUser = signal<UserI | null>(null);

  #users = signal<UserListI | null>(null);
  users = computed(this.#users);

  constructor() {
    this.getCurrentUser().subscribe();
  }

  getCurrentUser(): Observable<UserI> {
    return this.http
      .get<UserI>(this._GET_CURRENT_USER_URL)
      .pipe(tap((res) => this.currentUser.set(res)));
  }

  fetchUsers(offset = 0, limit = 20): Observable<UserListI> {
    return this.http
      .get<UserListI>(`${this._GET_USERS_URL}?offset=${offset}&limit=${limit}`)
      .pipe(tap((res) => this.#users.set(res)));
  }

  searchUsers(query: string) {
    const url = `${this._SEARCH_USERS_URL}?q=${query}`;
    return this.http
      .get<UserListI>(url)
      .pipe(tap((res) => this.#users.set(res)));
  }
}

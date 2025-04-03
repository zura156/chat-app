import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { UserI } from '../../../shared/interfaces/user.interface';
import { Observable, tap } from 'rxjs';
import { UserList } from '../../../shared/interfaces/user-list.interface';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);

  private readonly apiUrl = environment.apiUrl;

  private readonly _GET_CURRENT_USER_URL = `${this.apiUrl}/user/profile`;
  private readonly _GET_USERS_URL = `${this.apiUrl}/user/users`;
  private readonly _SEARCH_USERS_URL = `${this.apiUrl}/user/users/search`;

  currentUser = signal<UserI | null>(null);

  #users = signal<UserI[]>([]);
  users = computed(this.#users);

  constructor() {
    this.getCurrentUser().subscribe();
  }

  getCurrentUser(): Observable<UserI> {
    return this.http
      .get<UserI>(this._GET_CURRENT_USER_URL)
      .pipe(tap((res) => this.currentUser.set(res)));
  }

  fetchUsers(): Observable<UserList> {
    return this.http
      .get<UserList>(this._GET_USERS_URL)
      .pipe(tap((res) => this.#users.set(res.users)));
  }

  searchUser(query: string) {
    const url = `${this._SEARCH_USERS_URL}?q=${query}`;
    return this.http
      .get<UserList>(url)
      .pipe(tap((res) => this.#users.set(res.users)));
  }
}

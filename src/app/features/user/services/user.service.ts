import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { UserI } from '../interfaces/user.interface';
import { Observable, of, tap } from 'rxjs';
import { UserListI } from '../interfaces/user-list.interface';
import { WebSocketService } from '../../messages/services/web-socket.service';
import { UserStatusMessage } from '../../messages/interfaces/web-socket-message.interface';
import { UserStateService } from './user-state.service';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);
  private userStateService = inject(UserStateService);
  private webSocketService = inject(WebSocketService);

  private readonly apiUrl = environment.apiUrl;

  private readonly _GET_CURRENT_USER_URL = `${this.apiUrl}/user/profile`;
  private readonly _GET_USERS_URL = `${this.apiUrl}/user`;
  private readonly _GET_USER_BY_ID = `${this.apiUrl}/user/:id`;
  private readonly _SEARCH_USERS_URL = `${this.apiUrl}/user/search`;

  currentUser = this.userStateService.currentUser;
  selectedUser = this.userStateService.selectedUser;

  #users = signal<UserListI | null>(null);
  users = computed(this.#users);

  constructor() {
    this.getCurrentUser().subscribe((res) => {
      this.webSocketService.connect(res._id);

      const currentUser = this.currentUser();

      if (currentUser) {
        const { _id } = currentUser;

        const data: UserStatusMessage = {
          type: 'user-status',
          user_id: _id,
          status: 'online',
          last_seen: new Date().toISOString(),
        };
        this.webSocketService.sendMessage(data);
      }
    });
  }

  getCurrentUser(): Observable<UserI> {
    return this.http
      .get<UserI>(this._GET_CURRENT_USER_URL)
      .pipe(tap((res) => this.userStateService.setCurrentUser(res)));
  }

  getUserById(userId: string): Observable<UserI> {
    const user = this.selectedUser();
    if (user && user._id === userId) return of(user);

    const url = `${this._GET_USER_BY_ID.split(':id')[0]}${userId}`;
    return this.http
      .get<UserI>(url)
      .pipe(tap((res) => this.userStateService.setSelectedUser(res)));
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

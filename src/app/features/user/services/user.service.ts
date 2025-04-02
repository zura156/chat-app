import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { UserI } from '../../../shared/interfaces/user.interface';
import { Observable, tap } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);

  private readonly apiUrl = environment.apiUrl;

  private readonly _GET_CURRENT_USER_URL = `${this.apiUrl}/user/profile`;

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

  fetchUsers() {}

  searchUser() {}
}

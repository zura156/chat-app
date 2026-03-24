import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { UserI } from '../interfaces/user.interface';
import { Observable, of, tap } from 'rxjs';
import { UserListI } from '../interfaces/user-list.interface';
import { UserStateService } from './user-state.service';
import { UpdateProfilePictureI } from '../interfaces/update-profile-picture.interface';
import { UpdateProfilePictureResponseI } from '../interfaces/update-profile-picture-response.interface';
import { toast } from '@spartan-ng/brain/sonner';
import { UpdateProfileDataI } from '../interfaces/update-profile-data.interface';

@Injectable({
  providedIn: 'root',
})
export class UserService {
  private http = inject(HttpClient);
  private userStateService = inject(UserStateService);

  private readonly apiUrl = environment.apiUrl;

  private readonly _GET_CURRENT_USER_URL = `${this.apiUrl}/user/profile`;
  private readonly _GET_USERS_URL = `${this.apiUrl}/user`;
  private readonly _GET_USER_BY_ID = `${this.apiUrl}/user/:id`;
  private readonly _SEARCH_USERS_URL = `${this.apiUrl}/user/search`;
  private readonly _UPDATE_PROFILE_PICTURE_URL = `${this.apiUrl}/user/profile-picture`;

  currentUser = this.userStateService.currentUser;

  #users = signal<UserListI | null>(null);
  users = computed(this.#users);
  #selectedUser = signal<UserI | null>(null);
  selectedUser = computed(this.#selectedUser);

  constructor() {}

  updateProfile(body: UpdateProfileDataI): Observable<UserI> {
    return this.http.patch<UserI>(`${this.apiUrl}/user/profile`, body).pipe(
      tap(() => {
        const currentUser = this.currentUser();
        if (!currentUser) {
          toast.error('Current user not found in state.');
          return;
        }
        this.userStateService.setCurrentUser({
          ...currentUser,
          username: body.username ?? currentUser?.username,
          first_name: body.first_name ?? currentUser?.first_name,
          last_name: body.last_name ?? currentUser?.last_name,
          bio: body.bio ?? currentUser?.bio,
        });
      }),
    );
  }

  updateProfilePicture(
    body: UpdateProfilePictureI,
  ): Observable<UpdateProfilePictureResponseI> {
    const formData = new FormData();
    formData.append('userId', body.userId);
    formData.append('profilePicture', body.profilePicture);

    return this.http
      .patch<UpdateProfilePictureResponseI>(
        this._UPDATE_PROFILE_PICTURE_URL,
        formData,
      )
      .pipe(
        tap(({ message, profilePictureUrl }) => {
          toast.success(message);
          const currentUser = this.currentUser();
          if (!currentUser) {
            toast.error('Current user not found in state.');
            return;
          }

          this.userStateService.setCurrentUser({
            ...currentUser,
            profile_picture: profilePictureUrl,
          });
        }),
      );
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
      .pipe(tap((res) => this.#selectedUser.set(res)));
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

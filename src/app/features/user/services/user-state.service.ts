import { Injectable, signal, computed } from '@angular/core';
import { UserI } from '../interfaces/user.interface';

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  private _currentUser = signal<UserI | null>(null);
  private _selectedUser = signal<UserI | null>(null);

  readonly currentUser = computed(() => this._currentUser());
  readonly selectedUser = computed(() => this._selectedUser());

  setCurrentUser(user: UserI | null): void {
    this._currentUser.set(user);
  }

  setSelectedUser(user: UserI | null): void {
    this._selectedUser.set(user);
  }

  getCurrentUserId(): string | null {
    return this.currentUser()?._id || null;
  }

  isCurrentUser(userId: string): boolean {
    return this.currentUser()?._id === userId;
  }
}

import { Injectable, signal, computed } from '@angular/core';
import { UserI } from '../interfaces/user.interface';
import { ParticipantI } from '../../messages/interfaces/participant.interface';

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  private _currentUser = signal<UserI | null>(null);
  private _selectedUser = signal<ParticipantI | null>(null);

  readonly currentUser = this._currentUser.asReadonly();
  readonly selectedUser = this._selectedUser.asReadonly();

  constructor() {
    const selectedUser = sessionStorage.getItem('selectedUser');
    if (!selectedUser) return;

    try {
      this._selectedUser.set(JSON.parse(selectedUser));
    } catch {
      sessionStorage.removeItem('selectedUser');
    }
  }

  setCurrentUser(user: UserI | null): void {
    this._currentUser.set(user);
  }

  setSelectedUser(user: ParticipantI | null): void {
    this._selectedUser.set(user);
  }

  getCurrentUserId(): string | null {
    return this.currentUser()?._id || null;
  }

  isCurrentUser(userId: string): boolean {
    return this.currentUser()?._id === userId;
  }
}

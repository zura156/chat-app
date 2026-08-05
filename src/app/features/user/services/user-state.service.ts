import { Injectable, signal } from '@angular/core';
import { UserI } from '../interfaces/user.interface';
import { ParticipantI } from '../../messages/interfaces/participant.interface';

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  private _currentUser = signal<UserI | null>(null);
  private _selectedUser = signal<ParticipantI | null>(null);

  /**
   * Set when the API has actually refused a request for want of a verified
   * address.
   *
   * Driven by the server's answer rather than by mirroring its configuration:
   * whether verification is enforced is a deployment setting, and a client-side
   * copy of it is one redeploy away from disagreeing — showing a "verify your
   * email" wall to users the server is perfectly happy to serve.
   *
   * Lives here rather than on AuthService so the HTTP interceptor can set it
   * without injecting the service that owns the HttpClient it runs inside.
   */
  private _emailVerificationRequired = signal(false);

  readonly currentUser = this._currentUser.asReadonly();
  readonly selectedUser = this._selectedUser.asReadonly();
  readonly emailVerificationRequired =
    this._emailVerificationRequired.asReadonly();

  flagEmailVerificationRequired(): void {
    this._emailVerificationRequired.set(true);
  }

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
    // A verified user clears the wall — this is what makes "I've verified"
    // take effect without a reload.
    if (user?.is_email_verified) this._emailVerificationRequired.set(false);
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

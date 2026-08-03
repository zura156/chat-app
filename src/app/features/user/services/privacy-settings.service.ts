import { Service, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, tap } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { UserI } from '../interfaces/user.interface';
import { UserService } from './user.service';

export type Visibility = 'everyone' | 'contacts' | 'nobody';

export interface PrivacySettingsI {
  last_seen: Visibility;
  pfp_url: Visibility;
  bio: Visibility;
  online_status: Visibility;
}

/**
 * Backs the privacy screen. Its four visibility dropdowns previously had no
 * model, no GET and no PATCH behind them, and its unblock button was a
 * `console.log`.
 */
@Service()
export class PrivacySettingsService {
  private readonly http = inject(HttpClient);
  private readonly userService = inject(UserService);
  private readonly privacyUrl = `${environment.apiUrl}/user/privacy`;

  private readonly _privacy = signal<PrivacySettingsI>({
    last_seen: 'everyone',
    pfp_url: 'everyone',
    bio: 'everyone',
    online_status: 'everyone',
  });
  readonly privacy = this._privacy.asReadonly();

  private readonly _blockedUsers = signal<UserI[]>([]);
  readonly blockedUsers = this._blockedUsers.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _saving = signal<ReadonlySet<string>>(new Set());
  readonly saving = this._saving.asReadonly();

  load() {
    this._loading.set(true);

    return forkJoin({
      privacy: this.http.get<{ privacy: PrivacySettingsI }>(this.privacyUrl),
      blocked: this.userService.getBlockedUsers(),
    }).pipe(
      tap({
        next: ({ privacy, blocked }) => {
          this._privacy.set(privacy.privacy);
          this._blockedUsers.set(blocked?.users ?? []);
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
      map(() => void 0),
    );
  }

  /** Optimistic, and rolled back if the request fails. */
  setVisibility(key: keyof PrivacySettingsI, value: Visibility) {
    const previous = this._privacy()[key];
    this._privacy.update((p) => ({ ...p, [key]: value }));
    this.markSaving(key, true);

    return this.http.patch<{ privacy: PrivacySettingsI }>(this.privacyUrl, {
      [key]: value,
    }).pipe(
      tap({
        next: (res) => {
          this._privacy.set(res.privacy);
          this.markSaving(key, false);
        },
        error: () => {
          this._privacy.update((p) => ({ ...p, [key]: previous }));
          this.markSaving(key, false);
        },
      }),
    );
  }

  unblock(user: UserI) {
    const snapshot = this._blockedUsers();
    this._blockedUsers.update((users) =>
      users.filter((u) => u._id !== user._id),
    );

    return this.userService.unblockUser(user._id).pipe(
      tap({
        error: () => this._blockedUsers.set(snapshot),
      }),
    );
  }

  isSaving(key: keyof PrivacySettingsI): boolean {
    return this._saving().has(key);
  }

  private markSaving(key: string, saving: boolean): void {
    this._saving.update((keys) => {
      const next = new Set(keys);
      saving ? next.add(key) : next.delete(key);
      return next;
    });
  }
}

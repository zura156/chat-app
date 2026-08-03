import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, map, tap } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ConversationI } from '../../../../messages/interfaces/conversation.interface';
import { ConversationListI } from '../../../../messages/interfaces/conversation-list.interface';

/**
 * Root-provided rather than reusing ConversationService, which is provided on
 * the `messages` route and so is not reachable from `/settings`.
 *
 * Per-conversation mute is the only notification preference the server actually
 * has. There is no preferences model behind the other toggles this screen used
 * to show, which is why they are gone rather than wired up.
 */
@Injectable({ providedIn: 'root' })
export class NotificationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly conversationsUrl = `${environment.apiUrl}/conversations`;

  private readonly _conversations = signal<ConversationI[]>([]);
  readonly conversations = this._conversations.asReadonly();

  private readonly _mutedIds = signal<ReadonlySet<string>>(new Set());
  readonly mutedIds = this._mutedIds.asReadonly();

  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  private readonly _pending = signal<ReadonlySet<string>>(new Set());
  readonly pending = this._pending.asReadonly();

  load() {
    this._loading.set(true);

    return forkJoin({
      list: this.http.get<ConversationListI>(this.conversationsUrl),
      muted: this.http.get<{ conversationIds: string[] }>(
        `${this.conversationsUrl}/muted`,
      ),
    }).pipe(
      tap({
        next: ({ list, muted }) => {
          this._conversations.set(list?.conversations ?? []);
          this._mutedIds.set(new Set(muted?.conversationIds ?? []));
          this._loading.set(false);
        },
        error: () => this._loading.set(false),
      }),
      map(() => void 0),
    );
  }

  isMuted(conversationId: string): boolean {
    return this._mutedIds().has(conversationId);
  }

  /**
   * Applied optimistically and rolled back on failure: the toggle is the only
   * feedback the user gets, so it has to move immediately and has to be honest
   * if the request did not land.
   */
  toggleMute(conversationId: string) {
    const muted = this.isMuted(conversationId);
    this.setMuted(conversationId, !muted);
    this.markPending(conversationId, true);

    const request = muted
      ? this.http.delete(`${this.conversationsUrl}/${conversationId}/mute`)
      : this.http.post(`${this.conversationsUrl}/${conversationId}/mute`, {});

    return request.pipe(
      tap({
        next: () => this.markPending(conversationId, false),
        error: () => {
          this.setMuted(conversationId, muted);
          this.markPending(conversationId, false);
        },
      }),
    );
  }

  private setMuted(conversationId: string, muted: boolean): void {
    this._mutedIds.update((ids) => {
      const next = new Set(ids);
      muted ? next.add(conversationId) : next.delete(conversationId);
      return next;
    });
  }

  private markPending(conversationId: string, pending: boolean): void {
    this._pending.update((ids) => {
      const next = new Set(ids);
      pending ? next.add(conversationId) : next.delete(conversationId);
      return next;
    });
  }
}

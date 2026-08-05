import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import {
  MessageStatusMessage,
  RateLimitedMessage,
  TypingMessage,
  UserStatusMessage,
  WebSocketMessageT,
} from '../interfaces/web-socket-message.interface';
import {
  catchError,
  EMPTY,
  filter,
  Observable,
  retry,
  Subject,
  takeUntil,
  timer,
} from 'rxjs';
import { toast } from '@spartan-ng/brain/sonner';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket$?: WebSocketSubject<WebSocketMessageT>;
  private readonly messages$ = new Subject<WebSocketMessageT>();
  private readonly reconnected$ = new Subject<void>();
  private hasConnectedBefore = false;
  private networkListenersBound = false;

  /**
   * Whether a connection is currently *wanted*.
   *
   * Without this, `close()` left the network listeners bound and
   * `hasConnectedBefore` true, so the first `visibilitychange` after a logout
   * called `retryNow()` and reopened the socket. The cookies were gone, so the
   * upgrade 401'd — and the infinite retry below then reconnected forever,
   * against a server that would never accept it.
   */
  private shouldBeConnected = false;

  // Signal for connection state — consumed by components/computed without subscriptions
  readonly connected = signal(false);

  // takeUntilDestroyed must be called in injection context
  private readonly destroyRef = inject(DestroyRef);

  private readonly close$ = new Subject<void>();

  readonly typingMessage = toSignal(
    this.onMessageOfType<TypingMessage>('typing'),
    { initialValue: null },
  );

  readonly userStatusMessage = toSignal(
    this.onMessageOfType<UserStatusMessage>('user-status'),
    { initialValue: null },
  );

  readonly messageStatusMessage = toSignal(
    this.onMessageOfType<MessageStatusMessage>('message-status'),
    { initialValue: null },
  );

  /**
   * Types worth re-sending once the server's budget refills. Both carry state
   * the server has to converge on — an unread watermark and a presence flag —
   * so a dropped one stays wrong indefinitely: a stale badge, or appearing
   * offline to everyone.
   *
   * `typing` is deliberately absent. It is ephemeral, and by the time a cooldown
   * ends the next keystroke has already produced a fresher one.
   */
  private static readonly REPLAYABLE_TYPES = new Set([
    'message-status',
    'user-status',
  ]);

  /** The latest outgoing frame per type, so a dropped one can be replayed. */
  private readonly lastSentByType = new Map<string, WebSocketMessageT>();
  private readonly replayTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor() {
    this.onMessageOfType<RateLimitedMessage>('rate-limited')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((notice) => this.scheduleReplay(notice));
  }

  /**
   * The server dropped a frame for exceeding its per-type budget and said when
   * to try again. Previously it dropped them in silence and there was nothing
   * to react to.
   */
  private scheduleReplay(notice: RateLimitedMessage): void {
    const { message_type, retry_after } = notice;
    if (!WebSocketService.REPLAYABLE_TYPES.has(message_type)) return;
    if (!this.lastSentByType.has(message_type)) return;

    // One pending replay per type. A client still over budget has its replay
    // rescheduled rather than stacked, so this cannot amplify into the flood it
    // is recovering from.
    clearTimeout(this.replayTimers.get(message_type));
    this.replayTimers.set(
      message_type,
      setTimeout(
        () => {
          this.replayTimers.delete(message_type);
          // Re-read rather than closing over the frame from when the notice
          // arrived: what matters is the freshest watermark, not the one that
          // happened to be dropped.
          const latest = this.lastSentByType.get(message_type);
          if (latest) this.sendMessage(latest);
        },
        Math.max(retry_after, 1) * 1000,
      ),
    );
  }

  connect(): void {
    this.shouldBeConnected = true;
    if (this.socket$ && !this.socket$.closed) return;

    this.listenForNetworkRestore();

    // No token — cookies sent automatically on the upgrade request
    this.socket$ = webSocket<WebSocketMessageT>({
      url: environment.wsUrl,
      openObserver: {
        next: () => {
          this.connected.set(true);
          // Anything that happened while we were away was missed: tell
          // consumers to re-announce presence and refetch.
          if (this.hasConnectedBefore) this.reconnected$.next();
          this.hasConnectedBefore = true;
        },
      },
      closeObserver: {
        next: () => {
          this.connected.set(false);
        },
      },
    });

    this.socket$
      .pipe(
        // Retry indefinitely with capped exponential backoff + jitter. Giving
        // up after 5 tries (~30s) left the app silently disconnected after any
        // longer outage — sleep, tunnel, deploy — until a manual refresh.
        retry({
          delay: (_, attempt) =>
            timer(
              Math.min(
                RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
                RECONNECT_MAX_DELAY_MS,
              ) +
                Math.random() * 500,
            ),
          resetOnSuccess: true,
        }),
        catchError((err) => {
          console.error('WebSocket stream terminated:', err);
          this.connected.set(false);
          toast.error('Connection lost. Please refresh.');
          return EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef), // auto-cleanup, no ngOnDestroy needed
        takeUntil(this.close$),
      )
      .subscribe({
        next: (msg) => this.messages$.next(msg),
        error: (err) => console.error('WebSocket stream error:', err),
      });
  }

  /** Emits each time the socket comes back after having been connected. */
  onReconnect(): Observable<void> {
    return this.reconnected$.asObservable();
  }

  /**
   * Backoff alone can leave the app idle for up to 15s after the network is
   * already back; these events are the reliable signal to retry immediately.
   */
  private listenForNetworkRestore(): void {
    if (this.networkListenersBound) return;
    this.networkListenersBound = true;

    const retryNow = () => {
      // `shouldBeConnected` is the difference between "dropped" and
      // "deliberately closed". Reconnecting after a logout is not a recovery.
      if (!this.shouldBeConnected) return;
      if (this.connected() || !this.hasConnectedBefore) return;
      this.close$.next();
      this.socket$?.complete();
      this.socket$ = undefined;
      this.connect();
    };

    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryNow();
    });
  }

  sendMessage(data: WebSocketMessageT): void {
    // Recorded before the open check, so the newest intent is what a replay
    // picks up regardless of what the socket was doing at the time.
    this.lastSentByType.set(data.type, data);

    if (!this.socket$ || this.socket$.closed) {
      console.warn('WebSocket not open. Message dropped:', data);
      return;
    }
    this.socket$.next(data);
  }

  // Full stream — consumers filter by type themselves
  onMessage(): Observable<WebSocketMessageT> {
    return this.messages$.asObservable();
  }

  // Convenience: filter by message type at the source
  onMessageOfType<T extends WebSocketMessageT>(type: T['type']): Observable<T> {
    return this.messages$
      .asObservable()
      .pipe(filter((msg): msg is T => msg.type === type));
  }

  close(): void {
    this.shouldBeConnected = false;

    // A replay fired after a sign-out would announce the previous session's
    // presence over a socket that no longer belongs to it.
    for (const timer of this.replayTimers.values()) clearTimeout(timer);
    this.replayTimers.clear();
    this.lastSentByType.clear();

    // Reset so a later sign-in is treated as a first connection rather than a
    // reconnect, and does not fire `onReconnect` to consumers that would then
    // refetch on behalf of a session that just ended.
    this.hasConnectedBefore = false;
    this.close$.next();
    this.socket$?.complete();
    this.socket$ = undefined;
    this.connected.set(false);
  }
}

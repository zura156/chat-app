import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { environment } from '../../../../environments/environment';
import {
  MessageStatusMessage,
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
  share,
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
  private messages$ = new Subject<WebSocketMessageT>();
  private readonly reconnected$ = new Subject<void>();
  private hasConnectedBefore = false;
  private networkListenersBound = false;

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

  connect(): void {
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
        share(),
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
    this.close$.next();
    this.socket$?.complete();
    this.socket$ = undefined;
    this.connected.set(false);
  }

  reset(): void {
    this.close();
    this.messages$ = new Subject<WebSocketMessageT>();
  }
}

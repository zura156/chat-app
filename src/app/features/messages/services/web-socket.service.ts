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

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket$?: WebSocketSubject<WebSocketMessageT>;
  private messages$ = new Subject<WebSocketMessageT>();

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

    // No token — cookies sent automatically on the upgrade request
    this.socket$ = webSocket<WebSocketMessageT>({
      url: environment.wsUrl,
      openObserver: {
        next: () => {
          this.connected.set(true);
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
        retry({
          count: MAX_RECONNECT_ATTEMPTS,
          delay: (_, attempt) => timer(RECONNECT_DELAY_MS * attempt), // 2s, 4s, 6s...
          resetOnSuccess: true,
        }),
        catchError((err) => {
          console.error('WebSocket failed after max retries:', err);
          this.connected.set(false);
          toast.error('Failed to reconnect. Please refresh.');
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

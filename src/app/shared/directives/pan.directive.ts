import {
  Directive,
  ElementRef,
  EventEmitter,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';

/** Below this, a gesture is treated as a tap rather than a pan. */
const MIN_PAN_DISTANCE = 10;

/**
 * Horizontal swipe detection.
 *
 * Listeners are registered manually rather than with @HostListener for two
 * reasons: @HostListener registers `touchmove` as non-passive, which forces the
 * browser to wait on the handler before it can scroll, and it runs the callback
 * inside the Angular zone, triggering a change-detection pass for every frame
 * of every scroll gesture. Both made the chat feel unscrollable on mobile.
 */
@Directive({
  selector: '[appPan]',
})
export class PanGestureDirective implements OnInit, OnDestroy {
  @Output() panStart = new EventEmitter<TouchEvent>();
  @Output() panMove = new EventEmitter<TouchEvent>();
  @Output() panEnd = new EventEmitter<{ deltaX: number; deltaY: number }>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  private startX = 0;
  private startY = 0;
  private tracking = false;
  /** set once a gesture is clearly a vertical scroll — then we stay out of it */
  private verticalScroll = false;

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      const host = this.el.nativeElement;
      host.addEventListener('touchstart', this.onTouchStart, { passive: true });
      host.addEventListener('touchmove', this.onTouchMove, { passive: true });
      host.addEventListener('touchend', this.onTouchEnd, { passive: true });
      host.addEventListener('touchcancel', this.onTouchCancel, {
        passive: true,
      });
    });
  }

  ngOnDestroy(): void {
    const host = this.el.nativeElement;
    host.removeEventListener('touchstart', this.onTouchStart);
    host.removeEventListener('touchmove', this.onTouchMove);
    host.removeEventListener('touchend', this.onTouchEnd);
    host.removeEventListener('touchcancel', this.onTouchCancel);
  }

  private readonly onTouchStart = (event: TouchEvent): void => {
    // a second finger (pinch-zoom) cancels the pan rather than leaving stale
    // start coordinates behind
    if (event.touches.length !== 1) {
      this.tracking = false;
      return;
    }

    this.tracking = true;
    this.verticalScroll = false;
    this.startX = event.touches[0].clientX;
    this.startY = event.touches[0].clientY;
    this.zone.run(() => this.panStart.emit(event));
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (!this.tracking || this.verticalScroll) return;

    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;

    // Once the gesture commits to the vertical axis it belongs to the scroll
    // container; emitting for it would only cost change detection.
    if (
      Math.abs(deltaY) > Math.abs(deltaX) &&
      Math.abs(deltaY) > MIN_PAN_DISTANCE
    ) {
      this.verticalScroll = true;
      this.tracking = false;
      return;
    }

    if (Math.abs(deltaX) < MIN_PAN_DISTANCE) return;

    this.zone.run(() => this.panMove.emit(event));
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (!this.tracking) return;
    this.tracking = false;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;

    // vertical-dominant gestures are scrolls, not swipes
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;

    this.zone.run(() => this.panEnd.emit({ deltaX, deltaY }));
  };

  private readonly onTouchCancel = (): void => {
    this.tracking = false;
    this.verticalScroll = false;
  };
}

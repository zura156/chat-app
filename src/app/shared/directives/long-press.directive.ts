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

/** Matches the press-and-hold duration both mobile platforms use natively. */
const LONG_PRESS_MS = 500;
/** Past this the finger is scrolling the thread, not holding a message. */
const MOVE_TOLERANCE = 10;

/**
 * Press-and-hold, for touch only.
 *
 * Deliberately built on touch events rather than pointer events: a pointerdown
 * handler would also fire for the mouse, and on a pointer device holding the
 * button down is not how anyone opens a context menu.
 *
 * Listeners are registered manually and passively outside the Angular zone, for
 * the same reason {@link PanGestureDirective} does — these sit on every message
 * in the thread, and a non-passive touchmove on any of them makes the whole
 * chat feel unscrollable on mobile.
 */
@Directive({
  selector: '[appLongPress]',
})
export class LongPressDirective implements OnInit, OnDestroy {
  @Output() longPress = new EventEmitter<void>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  private timer?: ReturnType<typeof setTimeout>;
  private startX = 0;
  private startY = 0;
  private touching = false;
  /** a press that reached full duration, still owing us a click to swallow */
  private fired = false;

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      const host = this.el.nativeElement;
      host.addEventListener('touchstart', this.onTouchStart, { passive: true });
      host.addEventListener('touchmove', this.onTouchMove, { passive: true });
      host.addEventListener('touchend', this.onTouchEnd, { passive: true });
      host.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
      // Suppressing the platform's own press-and-hold callout needs a
      // cancelable listener. contextmenu never gates scrolling, so unlike
      // touchmove there is nothing to lose by leaving this one non-passive.
      host.addEventListener('contextmenu', this.onContextMenu);
      // The tap that ends a long press still lands on whatever is under the
      // finger — without this, holding an image opens the media viewer behind
      // the menu we just opened.
      host.addEventListener('click', this.onClick, { capture: true });
    });
  }

  ngOnDestroy(): void {
    const host = this.el.nativeElement;
    host.removeEventListener('touchstart', this.onTouchStart);
    host.removeEventListener('touchmove', this.onTouchMove);
    host.removeEventListener('touchend', this.onTouchEnd);
    host.removeEventListener('touchcancel', this.onTouchEnd);
    host.removeEventListener('contextmenu', this.onContextMenu);
    host.removeEventListener('click', this.onClick, { capture: true });
    this.clearTimer();
  }

  private readonly onTouchStart = (event: TouchEvent): void => {
    // a second finger means a pinch, not a hold
    if (event.touches.length !== 1) {
      this.clearTimer();
      return;
    }

    this.touching = true;
    this.fired = false;
    this.startX = event.touches[0].clientX;
    this.startY = event.touches[0].clientY;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fired = true;
      this.zone.run(() => this.longPress.emit());
    }, LONG_PRESS_MS);
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (!this.timer || !touch) return;

    if (
      Math.abs(touch.clientX - this.startX) > MOVE_TOLERANCE ||
      Math.abs(touch.clientY - this.startY) > MOVE_TOLERANCE
    ) {
      this.clearTimer();
    }
  };

  private readonly onTouchEnd = (): void => {
    this.touching = false;
    this.clearTimer();
  };

  private readonly onContextMenu = (event: Event): void => {
    // Only ours to suppress when it came from a finger. A right-click on a
    // pointer device is the browser's to handle.
    if (this.touching || this.fired) event.preventDefault();
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (!this.fired) return;
    this.fired = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

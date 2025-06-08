import { Directive, HostListener, Output, EventEmitter } from '@angular/core';

@Directive({
  selector: '[appSwipe]',
  standalone: true,
})
export class SwipeDirective {
  @Output() swipeLeft = new EventEmitter<void>();
  @Output() swipeRight = new EventEmitter<void>();

  private swipeCoord?: [number, number];
  private swipeTime?: number;

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent) {
    this.swipeCoord = [
      event.changedTouches[0].clientX,
      event.changedTouches[0].clientY,
    ];
    this.swipeTime = new Date().getTime();
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    const coord: [number, number] = [
      event.changedTouches[0].clientX,
      event.changedTouches[0].clientY,
    ];
    const time = new Date().getTime();

    if (this.swipeTime && this.swipeCoord) {
      const dx = coord[0] - this.swipeCoord[0];
      const dy = coord[1] - this.swipeCoord[1];
      const dt = time - this.swipeTime;

      // Detect a horizontal swipe that is fast enough
      if (dt < 500 && Math.abs(dx) > 60 && Math.abs(dy) < 60) {
        if (dx > 0) {
          this.swipeRight.emit();
        } else {
          this.swipeLeft.emit();
        }
      }
    }
  }
}

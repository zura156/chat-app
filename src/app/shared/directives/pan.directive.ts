import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Output,
} from '@angular/core';

@Directive({
  selector: '[appPan]',
})
export class PanGestureDirective {
  @Output() panStart = new EventEmitter<TouchEvent>();
  @Output() panMove = new EventEmitter<TouchEvent>();
  @Output() panEnd = new EventEmitter<{ deltaX: number; deltaY: number }>();

  private startX = 0;
  private startY = 0;

  constructor(private el: ElementRef) {}

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent) {
    if (event.touches.length === 1) {
      this.startX = event.touches[0].clientX;
      this.startY = event.touches[0].clientY;
      this.panStart.emit(event);
    }
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent) {
    this.panMove.emit(event);
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;
    this.panEnd.emit({ deltaX, deltaY });
  }
}

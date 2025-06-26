import { Directive, EventEmitter, HostListener, Output } from '@angular/core';

export interface PanData {
  event: PointerEvent;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

@Directive({
  selector: '[appPan]',
  standalone: true,
})
export class PanDirective {
  @Output() panStart = new EventEmitter<PanData>();
  @Output() panMove = new EventEmitter<PanData>();
  @Output() panEnd = new EventEmitter<PanData>();

  private isPanning = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;

  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent) {
    if (this.isPanning) return;
    this.isPanning = true;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startY = event.clientY;

    const target = event.target as Element;
    target?.setPointerCapture?.(event.pointerId);

    this.panStart.emit({
      event,
      startX: this.startX,
      startY: this.startY,
      deltaX: 0,
      deltaY: 0,
    });
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent) {
    if (!this.isPanning || event.pointerId !== this.pointerId) return;

    const deltaX = event.clientX - this.startX;
    const deltaY = event.clientY - this.startY;

    this.panMove.emit({
      event,
      startX: this.startX,
      startY: this.startY,
      deltaX,
      deltaY,
    });
  }

  @HostListener('document:pointerup', ['$event'])
  onPointerUp(event: PointerEvent) {
    if (!this.isPanning || event.pointerId !== this.pointerId) return;

    const deltaX = event.clientX - this.startX;
    const deltaY = event.clientY - this.startY;

    this.panEnd.emit({
      event,
      startX: this.startX,
      startY: this.startY,
      deltaX,
      deltaY,
    });

    this.reset();
  }

  @HostListener('document:pointercancel', ['$event'])
  onPointerCancel(event: PointerEvent) {
    if (!this.isPanning || event.pointerId !== this.pointerId) return;
    this.reset();
  }

  private reset() {
    this.isPanning = false;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
  }
}

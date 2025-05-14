import { Directive, ElementRef, HostListener, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subject, fromEvent, takeUntil } from 'rxjs';
import { auditTime } from 'rxjs/operators';

@Directive({
  selector: '[appViewportTopVisible]',
})
export class ViewportTopVisibleDirective implements OnInit, OnDestroy {
  @Output() viewportTopVisible = new EventEmitter<boolean>();

  private element: HTMLElement;
  private destroy$ = new Subject<void>();

  constructor(private el: ElementRef) {
    this.element = this.el.nativeElement;
  }

  ngOnInit(): void {
    fromEvent(window, 'scroll')
      .pipe(auditTime(100), takeUntil(this.destroy$))
      .subscribe(() => this.checkVisibility());

    // Initial check in case the element is already in the viewport on load
    this.checkVisibility();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkVisibility(): void {
    if (!this.element) {
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const isTopVisible = rect.top >= 0;

    this.viewportTopVisible.emit(isTopVisible);
  }
}
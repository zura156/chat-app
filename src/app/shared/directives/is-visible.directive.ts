import {
  Directive,
  ElementRef,
  input,
  InputSignal,
  NgZone,
  OnDestroy,
  OnInit,
  output,
} from '@angular/core';

@Directive({
  selector: '[appIntersectionObserver]',
})
export class IntersectionObserverDirective implements OnInit, OnDestroy {
  visible = output<IntersectionObserverEntry>();
  options: InputSignal<IntersectionObserverInit> = input({});

  private observer?: IntersectionObserver;

  constructor(private element: ElementRef, private zone: NgZone) {}

  ngOnInit(): void {
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.zone.run(() => this.visible.emit(entry));
          }
        });
      }, this.options());

      this.observer.observe(this.element.nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}

import { Injectable } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ResponsiveService {
  isMobile$: Observable<boolean>;

  constructor(private observer: BreakpointObserver) {
    this.isMobile$ = this.observer
      .observe(['(max-width: 768px)'])
      .pipe(map((res) => res.matches));
  }
}

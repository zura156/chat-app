import {
  computed,
  Injectable,
  linkedSignal,
  OnDestroy,
  signal,
} from '@angular/core';
import { ActiveViewType } from '../interfaces/active-view.type';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject, takeUntil } from 'rxjs';

@Injectable()
export class LayoutService implements OnDestroy {
  isMobile = signal<boolean>(false);
  activeView = signal<ActiveViewType>('conversations');

  private destroy$ = new Subject<void>();

  constructor(private breakpointObserver: BreakpointObserver) {
    this.breakpointObserver
      .observe(['(max-width: 640px)'])
      .pipe(takeUntil(this.destroy$))
      .subscribe((result) => {
        this.isMobile.set(result.matches);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setActiveView(view: ActiveViewType): void {
    this.activeView.update(() => view);
  }
}

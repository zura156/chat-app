import { Injectable, OnDestroy, signal } from '@angular/core';
import {
  ActiveListViewType,
  ActiveViewType,
} from '../interfaces/active-view.types';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject, takeUntil } from 'rxjs';

@Injectable()
export class LayoutService implements OnDestroy {
  isMobile = signal<boolean>(false);
  activeView = signal<ActiveViewType>('chatbox');
  activeListView = signal<ActiveListViewType>('conversations');

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

  setActiveListView(view: ActiveListViewType): void {
    this.activeListView.update(() => view);
  }

  setActiveView(view: ActiveViewType): void {
    this.activeView.update(() => view);
  }
}

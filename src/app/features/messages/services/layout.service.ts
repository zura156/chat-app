import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import {
  ActiveListViewType,
  ActiveViewType,
} from '../interfaces/active-view.types';
import { BreakpointObserver } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable()
export class LayoutService {
  isMobile = signal<boolean>(false);
  activeView = signal<ActiveViewType>('chatbox');
  activeListView = signal<ActiveListViewType>('conversations');

  private breakpointObserver = inject(BreakpointObserver);
  private destroyRef = inject(DestroyRef);

  constructor() {
    this.breakpointObserver
      .observe(['(max-width: 640px)'])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.isMobile.set(result.matches);
      });
  }

  setActiveListView(view: ActiveListViewType): void {
    this.activeListView.update(() => view);
  }

  setActiveView(view: ActiveViewType): void {
    this.activeView.update(() => view);
  }
}

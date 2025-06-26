import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { NgTemplateOutlet } from '@angular/common';
import { filter, Subject, takeUntil, tap } from 'rxjs';
import {
  ActivatedRoute,
  NavigationEnd,
  ParamMap,
  Router,
  RouterOutlet,
} from '@angular/router';
import { MessageListComponent } from '../list/messages-list.component';
import { LayoutService } from './layout.service';
import { ActiveViewType } from '../interfaces/active-view.type';
import { PanDirective } from '../../../shared/directives/pan.directive';

@Component({
  selector: 'app-messages',
  imports: [
    RouterOutlet,
    PanDirective,
    ReactiveFormsModule,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    NgTemplateOutlet,
    MessageListComponent,
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private layoutService = inject(LayoutService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isMobile = signal<boolean>(false);
  activeView = this.layoutService.activeView;
  chatboxAnimationDirection = signal<'right' | 'left'>('right');

  windowWidth: number = window.innerWidth;

  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.checkForIdParam(this.route);
    this.checkScreenWidth();

    // Listen for router events
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        tap(() => this.checkForIdParam(this.route)),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  private checkForIdParam(route: ActivatedRoute) {
    let currentRoute = route;

    // Traverse the nested routes
    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
    }

    // Access paramMap and check for :id
    currentRoute.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params: ParamMap) => {
        const id = params.get('id');
        if (id) {
          this.setActiveView('chatbox');
        } else {
          this.setActiveView('conversations');
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any): void {
    this.windowWidth = window.innerWidth;
    this.checkScreenWidth();
  }

  private checkScreenWidth(): void {
    this.isMobile.set(this.windowWidth < 640);
  }

  onPanStart(data: any) {
    console.log('Pan Start', data.startX, data.startY);
  }

  onPanMove(data: any) {
    console.log('Move', data.deltaX.toFixed(2), data.deltaY.toFixed(2));
  }

  onPanEnd(data: any) {
    console.log('Pan End', data.deltaX.toFixed(2), data.deltaY.toFixed(2));
  }

  // onSwipeLeft() {
  //   if (this.isMobile()) {
  //     if (this.activeView() === 'conversations') {
  //       this.setActiveView('chatbox');
  //     } else if (this.activeView() === 'chatbox') {
  //       this.setActiveView('chatbox-settings');
  //     }
  //   }
  // }

  // onSwipeRight() {
  //   if (this.isMobile()) {
  //     if (this.activeView() === 'chatbox-settings') {
  //       this.setActiveView('chatbox');
  //     } else if (this.activeView() === 'chatbox') {
  //       this.setActiveView('conversations');
  //     }
  //   }
  // }

  setActiveView(destination: ActiveViewType) {
    this.layoutService.setActiveView(destination);
  }
}

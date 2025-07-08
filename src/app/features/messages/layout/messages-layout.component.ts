import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { NgTemplateOutlet } from '@angular/common';
import { filter, map, Subject, switchMap, takeUntil, tap } from 'rxjs';
import {
  ActivatedRoute,
  NavigationEnd,
  ParamMap,
  Params,
  Router,
  RouterOutlet,
} from '@angular/router';
import { MessageListComponent } from '../list/messages-list.component';
import { LayoutService } from './layout.service';
import { ActiveViewType } from '../interfaces/active-view.type';

@Component({
  selector: 'app-messages',
  imports: [
    RouterOutlet,
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
    this.checkScreenWidth();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => {
          let route = this.router.routerState.root;
          while (route.firstChild) {
            route = route.firstChild;
          }
          return route;
        }),
        switchMap((route) =>
          route.params.pipe(
            tap((params: Params) => {
              const id = params['id'];
              if (id) {
                this.setActiveView('chatbox');
              } else {
                this.setActiveView('conversations');
              }
            })
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
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

  setActiveView(destination: ActiveViewType) {
    this.layoutService.setActiveView(destination);
  }
}

import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { HlmSeparatorDirective } from '@spartan-ng/helm/separator';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { filter, map, Subject, switchMap, takeUntil, tap } from 'rxjs';
import { NavigationEnd, Params, Router, RouterOutlet } from '@angular/router';
import { ConversationListComponent } from '../list/conversation-list.component';
import { LayoutService } from './layout.service';
import { ActiveViewType } from '../interfaces/active-view.type';
import { IonRouterOutlet } from '@ionic/angular/standalone';

@Component({
  selector: 'app-messages',
  imports: [
    IonRouterOutlet,
    ReactiveFormsModule,
    NgTemplateOutlet,
    NgClass,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    ConversationListComponent,
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private layoutService = inject(LayoutService);
  private router = inject(Router);

  isMobile = this.layoutService.isMobile;
  activeView = this.layoutService.activeView;
  chatboxAnimationDirection = signal<'right' | 'left'>('right');
  isConversationListActive = signal<boolean>(true);

  windowWidth: number = window.innerWidth;

  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        tap((event: NavigationEnd) => {
          this.isConversationListActive.set(
            event.urlAfterRedirects === '/messages'
          );
        }),
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

  setActiveView(destination: ActiveViewType) {
    this.layoutService.setActiveView(destination);
  }
}

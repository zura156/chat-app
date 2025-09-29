import {
  Component,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { NgTemplateOutlet } from '@angular/common';
import { concatMap, filter, map, Subject, tap } from 'rxjs';
import {
  ActivatedRoute,
  NavigationEnd,
  Params,
  Router,
  RouterOutlet,
} from '@angular/router';
import { ConversationListComponent } from '../list/conversation-list.component';
import { LayoutService } from './layout.service';
import { ActiveViewType } from '../interfaces/active-view.type';
import { MessagesStartComponent } from '../start/messages-start.compoent';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-messages',
  imports: [
    RouterOutlet,
    ReactiveFormsModule,
    NgTemplateOutlet,
    HlmSeparatorImports,

    ConversationListComponent,
    MessagesStartComponent,
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly layoutService = inject(LayoutService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  isMobile = this.layoutService.isMobile;
  activeView = this.layoutService.activeView;
  chatboxAnimationDirection = signal<'right' | 'left'>('right');
  isConversationListActive = signal<boolean>(true);

  windowWidth: number = window.innerWidth;

  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.route.firstChild?.params
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((params: Params) => {
          const id = params['id'];
          if (id) {
            this.setActiveView('chatbox');
          } else {
            this.setActiveView('conversations');
          }
        }),
        concatMap(() =>
          this.router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            tap((event: NavigationEnd) => {
              this.isConversationListActive.set(
                event.urlAfterRedirects === '/messages'
              );
              this.setActiveView(
                event.urlAfterRedirects === '/messages'
                  ? 'conversations'
                  : 'chatbox'
              );
            }),
            map(() => {
              let route = this.router.routerState.root;
              while (route.firstChild) {
                route = route.firstChild;
              }
              return route;
            })
          )
        )
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

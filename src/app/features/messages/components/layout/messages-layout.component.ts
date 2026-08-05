import {
  Component,
  computed,
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
import { LayoutService } from '../../services/layout.service';
import { ActiveViewType } from '../../interfaces/active-view.types';
import { MessagesStartComponent } from '../start/messages-start.component';
import { VerifyEmailRequiredComponent } from '../../../auth/components/verify-email/verify-email-required.component';
import { AuthService } from '../../../auth/services/auth.service';
import { UserStateService } from '../../../user/services/user-state.service';
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
    VerifyEmailRequiredComponent,
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly layoutService = inject(LayoutService);
  private readonly authService = inject(AuthService);

  private readonly userState = inject(UserStateService);

  /**
   * Shown only when the API has actually refused a request for want of a
   * verified address *and* the loaded user is still unverified.
   *
   * Both halves matter: the refusal is what proves the server enforces this at
   * all (it is a deployment setting), and requiring a loaded user avoids
   * flashing the wall during the initial load, when nothing is known yet.
   */
  readonly needsEmailVerification = computed(
    () =>
      this.userState.emailVerificationRequired() &&
      !!this.authService.user() &&
      !this.authService.isEmailVerified(),
  );
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
          if (id || this.router.url.endsWith('new')) {
            this.setActiveView('chatbox');
          } else {
            this.setActiveView('lists');
          }
        }),
        concatMap(() =>
          this.router.events.pipe(
            filter((event) => event instanceof NavigationEnd),
            tap((event: NavigationEnd) => {
              this.isConversationListActive.set(
                event.urlAfterRedirects === '/messages',
              );
              this.setActiveView(
                event.urlAfterRedirects === '/messages' ? 'lists' : 'chatbox',
              );
            }),
            map(() => {
              let route = this.router.routerState.root;
              while (route.firstChild) {
                route = route.firstChild;
              }
              return route;
            }),
          ),
        ),
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

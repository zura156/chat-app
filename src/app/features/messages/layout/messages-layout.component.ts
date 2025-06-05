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
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { lucideChevronLeft } from '@ng-icons/lucide';
import {
  trigger,
  state,
  style,
  transition,
  animate,
} from '@angular/animations';
import { ChatboxSettingsComponent } from '../chatbox-settings/chatbox-settings.component';
import { ActiveViewType } from '../interfaces/active-view.type';

@Component({
  selector: 'app-messages',
  imports: [
    ChatboxSettingsComponent,
    RouterOutlet,
    ReactiveFormsModule,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    NgTemplateOutlet,
    NgIcon,
    HlmButtonDirective,
    HlmIconDirective,
    MessageListComponent,
  ],
  providers: [
    LayoutService,
    provideIcons({
      lucideChevronLeft,
    }),
  ],
  templateUrl: './messages-layout.component.html',
  animations: [
    trigger('slideAnimation', [
      state('left', style({ transform: 'translateX(0%)', opacity: 1 })),
      state('right', style({ transform: 'translateX(0%)', opacity: 1 })),

      transition('void => left', [
        style({ transform: 'translateX(-100%)', opacity: 0 }),
        animate('300ms ease-out'),
      ]),
      transition('left => void', [
        animate(
          '300ms ease-in',
          style({ transform: 'translateX(-100%)', opacity: 0 })
        ),
      ]),

      transition('void => right', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out'),
      ]),
      transition('right => void', [
        animate(
          '300ms ease-in',
          style({ transform: 'translateX(100%)', opacity: 0 })
        ),
      ]),
    ]),
  ],
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private layoutService = inject(LayoutService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  isMobile = signal<boolean>(false);
  isChatView = this.layoutService.isRightView;
  activeView = this.layoutService.activeView;
  animationDirection = signal<'left' | 'right' | null>(null);

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

  goBack(): void {
    this.setActiveView('conversations');
    this.router.navigate(['..']);
  }

  setActiveView(destination: ActiveViewType) {
    const current = this.activeView();

    this.layoutService.setActiveView(destination);

    if (current === destination) {
      return;
    }

    switch (current) {
      case 'chatbox':
        if (destination === 'conversations' || destination === 'users') {
          this.animationDirection.set('left');
        } else if (destination === 'chatbox-settings') {
          this.animationDirection.set('right');
        }
        break;

      case 'chatbox-settings':
        this.animationDirection.set('left');
        break;
      case 'conversations':
      case 'users':
        if (destination === 'chatbox' || destination === 'chatbox-settings') {
          this.animationDirection.set('right');
        }
        break;
    }
  }
}

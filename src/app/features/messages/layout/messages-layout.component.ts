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
import { filter, Subject, takeUntil } from 'rxjs';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { MessageListComponent } from '../list/messages-list.component';
import { LayoutService } from './layout.service';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { lucideChevronLeft } from '@ng-icons/lucide';

@Component({
  selector: 'app-messages',
  imports: [
    RouterOutlet,
    ReactiveFormsModule,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    NgTemplateOutlet,
    NgIcon,
    HlmButtonDirective,
    HlmIconDirective,
    MessageListComponent
],
  providers: [
    LayoutService,
    provideIcons({
      lucideChevronLeft,
    }),
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  private layoutService = inject(LayoutService);
  private router = inject(Router);

  isMobile = signal<boolean>(false);
  isChatView = this.layoutService.isRightView;

  windowWidth: number = window.innerWidth;

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.checkScreenWidth();

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
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

  goBack(): void {
    this.layoutService.setActiveView('conversations');
    this.layoutService.switchView();
    this.router.navigate(['..']);
  }
}

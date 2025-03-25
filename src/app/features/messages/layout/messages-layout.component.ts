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
import { NgIf, NgTemplateOutlet } from '@angular/common';
import { filter, Subject, takeUntil } from 'rxjs';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-messages',
  imports: [
    NgIf,
    RouterOutlet,
    ReactiveFormsModule,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    NgTemplateOutlet
  ],
  templateUrl: './messages-layout.component.html',
})
export class MessagesLayoutComponent implements OnInit, OnDestroy {
  isMobile = signal<boolean>(false);
  isChatView = signal<boolean>(false);

  private router = inject(Router);

  windowWidth: number = window.innerWidth;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.checkScreenWidth();
    this.checkRoute();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.checkRoute();
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

  private checkRoute(): void {
    const currentRoute = this.router.url;
    this.isChatView.set(
      currentRoute.includes('/new-chat') || /^\/\d+$/.test(currentRoute)
    );
  }
}

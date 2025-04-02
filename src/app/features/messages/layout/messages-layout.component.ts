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
import { WebSocketService } from '../services/web-socket.service';
import { MessageListComponent } from '../list/messages-list.component';
import { LayoutService } from './layout.service';

@Component({
  selector: 'app-messages',
  imports: [
    NgIf,
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
  isMobile = signal<boolean>(false);
  layoutService = inject(LayoutService);
  isChatView = this.layoutService.isRightView;

  private webSocketSerice = inject(WebSocketService);

  private router = inject(Router);

  windowWidth: number = window.innerWidth;
  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.webSocketSerice
      .onMessage()
      .pipe(takeUntil(this.destroy$))
      .subscribe((res) => console.log(res));

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
}

import { Component, effect, inject, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import { map, Subject, switchMap, takeUntil, tap } from 'rxjs';

@Component({
  selector: 'app-new-chat',
  imports: [],
  templateUrl: './new-chat.component.html',
})
export class NewChatComponent implements OnInit, OnDestroy {
  route = inject(ActivatedRoute);
  router = inject(Router);
  userService = inject(UserService);
  conversationService = inject(ConversationService);

  private readonly destroy$ = new Subject<void>();

  constructor() {
    effect(() => {
      if (this.userService.currentUser()) {
        this.createConversation();
      }
    });
  }

  ngOnInit(): void {}

  createConversation() {
    this.route.queryParams
      .pipe(
        takeUntil(this.destroy$),
        map((params) => params['userId']),
        switchMap((userId) => {
          return this.conversationService
            .createConversation([
              this.userService.currentUser()?._id ?? '',
              userId,
            ])
            .pipe(
              tap((conversation) => {
                this.router.navigateByUrl(`/messages/${conversation._id}`);
                console.log(conversation);
              })
            );
        })
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

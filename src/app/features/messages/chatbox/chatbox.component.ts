import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { map, Subject, switchMap, tap } from 'rxjs';
import { OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';

@Component({
  selector: 'app-chatbox',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chatbox.component.html',
})
export class ChatboxComponent implements OnInit, OnDestroy {
  userId = input<string>();

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private conversationService = inject(ConversationService);
  private messageService = inject(MessageService);

  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    // Initialize any necessary data or subscriptions here
    console.log('Chatbox component initialized');

    this.route.params
      .pipe(
        map((params) => params['id']),
        switchMap((id) =>
          this.conversationService
            .getConversationById(id ?? this.userId)
            .pipe(
              switchMap((conversation) =>
                this.messageService.getMessagesByConversationId(
                  conversation._id
                )
              )
            )
        )
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

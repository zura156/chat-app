import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { map, Subject, switchMap, tap } from 'rxjs';
import { OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { ConversationI } from '../interfaces/conversation.interface';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
  HlmAvatarFallbackDirective,
} from '@spartan-ng/ui-avatar-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { NgClass } from '@angular/common';
import { MessageI, MessageType } from '../interfaces/message.interface';
import { HlmCardContentDirective } from '@spartan-ng/ui-card-helm';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HlmFormFieldComponent } from '@spartan-ng/ui-formfield-helm';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';

@Component({
  selector: 'app-chatbox',
  imports: [
    NgClass,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmCardContentDirective,
    ReactiveFormsModule,
    HlmButtonDirective,
    HlmInputDirective,
  ],
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

  conversation: WritableSignal<ConversationI | null> =
    signal<ConversationI | null>(null);

  imageUrl = computed<string | null>(
    () => this.conversation()?.participants[1].profile_picture ?? null
  );

  messages = this.messageService.activeMessages;

  messageControl = new FormControl<string>('');

  currentUser = this.userService.currentUser;

  ngOnInit(): void {
    this.route.params
      .pipe(
        map((params) => params['id']),
        switchMap((id) =>
          this.conversationService.getConversationById(id ?? this.userId).pipe(
            tap((res) => {
              this.conversation.set(res);
            }),
            switchMap((conversation) =>
              this.messageService.getMessagesByConversationId(conversation._id)
            )
          )
        )
      )
      .subscribe();
  }

  isCurrentUserMessage(message: MessageI): boolean {
    return message.sender === this.userService.currentUser();
  }

  getMessageTime(message: MessageI): string {
    return new Date(message.createdAt || '').toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  sendMessage(): void {
    const sender = this.userService.currentUser();
    const convo = this.conversation();
    if (!sender || !convo || !this.messageControl.value) {
      return;
    }

    const message = {
      sender: sender._id,
      conversation: convo._id,
      content: this.messageControl.value,
      type: MessageType.TEXT, // will change this later
    };

    this.messageService.sendMessage(message).subscribe();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

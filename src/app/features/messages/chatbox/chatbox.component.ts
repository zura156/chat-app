import {
  ChangeDetectionStrategy,
  Component,
  inject,
  linkedSignal,
  OnInit,
  Signal,
  signal,
} from '@angular/core';
import {
  catchError,
  distinctUntilChanged,
  EMPTY,
  map,
  of,
  Subject,
  switchMap,
  takeUntil,
  tap,
  throwError,
} from 'rxjs';
import { OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { ConversationI } from '../interfaces/conversation.interface';
import {
  HlmAvatarImageDirective,
  HlmAvatarComponent,
} from '@spartan-ng/ui-avatar-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { NgClass, TitleCasePipe } from '@angular/common';
import {
  convertToMessageType,
  MessageI,
  MessageType,
} from '../interfaces/message.interface';
import {
  HlmCardDescriptionDirective,
  HlmCardDirective,
} from '@spartan-ng/ui-card-helm';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { HlmInputDirective } from '@spartan-ng/ui-input-helm';
import { WebSocketService } from '../services/web-socket.service';
import { HlmSpinnerComponent } from '@spartan-ng/ui-spinner-helm';
import { IntersectionObserverDirective } from '../../../shared/directives/is-visible.directive';
import { UserI } from '../../../shared/interfaces/user.interface';

import { toast } from 'ngx-sonner';
import { HlmToasterComponent } from '@spartan-ng/ui-sonner-helm';
import { ParticipantI } from '../interfaces/participant.interface';

@Component({
  selector: 'app-chatbox',
  imports: [
    NgClass,
    IntersectionObserverDirective,

    TitleCasePipe,
    HlmAvatarImageDirective,
    HlmAvatarComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,

    HlmCardDirective,
    HlmCardDescriptionDirective,

    HlmToasterComponent,

    ReactiveFormsModule,
    HlmButtonDirective,
    HlmInputDirective,

    HlmSpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chatbox.component.html',
  styleUrl: './chatbox.component.css'
})
export class ChatboxComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private conversationService = inject(ConversationService);
  private messageService = inject(MessageService);
  private webSocketService = inject(WebSocketService);

  private readonly destroy$ = new Subject<void>();

  conversation: Signal<ConversationI | null> = signal<ConversationI | null>(
    null
  );

  imageUrl = linkedSignal<string | null>(() => {
    const currentConversation = this.conversation();
    if (!currentConversation) {
      return null;
    }

    if (currentConversation.is_group) {
      return currentConversation.group_picture ?? null;
    } else {
      const otherUser = currentConversation.participants.find(
        (participant) => participant._id !== this.currentUser()?._id
      );
      return otherUser?.profile_picture ?? null;
    }
  });

  messages = this.messageService.activeMessages;

  messageControl = new FormControl<string>('');

  currentUser = this.userService.currentUser;
  selectedUser = this.conversationService.selectedUser;

  offset = signal<number>(0);
  limit = 20;
  hasMoreMessages = signal<boolean>(false);
  isLoading = signal<boolean>(false);
  isTyping = signal<{
    typer: Partial<ParticipantI>;
    is_typing: boolean;
  } | null>(null);

  ngOnInit(): void {
    if (window.visualViewport && window.visualViewport?.height > 1000) {
      this.limit = 40;
    }

    this.trackTypingStatus();

    this.isLoading.set(true);

    this.route.params
      .pipe(
        map((params) => params['id']),
        catchError((err) => {
          toast.error('Something went wrong!', {
            description: err.error.message,
            duration: 5000,
            position: 'bottom-right',
          });
          this.isLoading.set(false);
          return throwError(() => err);
        }),
        switchMap((id) => {
          this.conversation = this.conversationService.activeConversation;
          const selectedUser: UserI | null = JSON.parse(
            sessionStorage.getItem('selectedUser') ?? 'null'
          );
          if (selectedUser) {
            this.conversationService.selectUserForConversation(selectedUser);
            if (id === selectedUser?._id) {
              this.conversationService.createMockConversation();
              this.messageService.clearActiveMessages();
              return of(this.conversation()).pipe(
                tap(() => this.isLoading.set(false))
              );
            }
          }
          return this.conversationService.getConversationById(id).pipe(
            catchError((err) => {
              toast.error('Something went wrong!', {
                description: err.error.message,
                duration: 5000,
                position: 'bottom-right',
              });
              this.isLoading.set(false);
              return throwError(() => err);
            }),
            switchMap((c) => {
              if (!c) {
                return EMPTY;
              }
              return this.messageService
                .getMessagesByConversationId(c._id, 0, this.limit)
                .pipe(
                  tap((messagesList) => {
                    const duplicateIds = messagesList.messages.filter(
                      (id, index) => messagesList.messages.indexOf(id) !== index
                    );
                    if (duplicateIds.length > 0) {
                      console.warn('Duplicate _id values found:', duplicateIds);
                    }
                    this.offset.set(messagesList.messages.length);
                    if (messagesList.totalCount <= this.offset()) {
                      this.hasMoreMessages.set(false);
                    }
                    this.isLoading.set(false);
                  }),
                  catchError((err) => {
                    toast.error('Something went wrong!', {
                      description: err.error.message,
                      duration: 5000,
                      position: 'bottom-right',
                    });
                    this.isLoading.set(false);
                    return throwError(() => err);
                  }),
                  switchMap(
                    () =>
                      this.webSocketService.onMessage()?.pipe(
                        tap((res) => {
                          if (res.type === 'typing') {
                            this.isTyping.set({
                              typer: res.sender ?? {},
                              is_typing: !!res.is_typing,
                            });
                            return;
                          }

                          const convo = this.conversation();
                          const user = this.currentUser();

                          if (!user || !convo) return;

                          // Process incoming message only if it belongs to the current conversation
                          if (res.conversation === (convo && convo._id)) {
                            if (res.sender === user._id) {
                              const savedMessage: MessageI = {
                                _id: res._id,
                                sender: res.sender,
                                conversation: res.conversation,
                                content: res.content ?? '',
                                type: convertToMessageType(res.type),
                                createdAt: res.createdAt || '',
                                updatedAt: res.updatedAt || '',
                              };

                              this.messageService.fillInMessageDetails(
                                savedMessage
                              );
                              return;
                            }

                            const message: MessageI = {
                              _id: res._id,
                              sender: res.sender!,
                              conversation: this.conversation()?._id!,
                              content: res.content!,
                              type: MessageType.TEXT,
                            };
                            this.messageService.addMessage(message);
                          }
                        }),
                        catchError((err) => {
                          toast.error('Something went wrong!', {
                            description: err.error.message,
                            duration: 5000,
                            position: 'bottom-right',
                          });
                          this.isLoading.set(false);
                          return throwError(() => err);
                        })
                      ) || EMPTY
                  )
                );
            })
          );
        })
      )
      .subscribe();
  }

  isCurrentUserMessage(message: MessageI): boolean {
    return (
      (message.sender._id || message.sender) ===
      this.userService.currentUser()?._id
    );
  }

  sendMessage(): void {
    const sender = this.userService.currentUser();
    const convo = this.conversation();

    if (!convo || !sender || !this.messageControl.value) return;

    if (!convo.createdAt) {
      this.isLoading.set(true);

      this.conversationService
        .createConversation([sender._id, this.selectedUser()!._id])
        .pipe(
          catchError((err) => {
            toast.error('Something went wrong!', {
              description: err.error.message,
              duration: 5000,
              position: 'bottom-right',
            });
            this.isLoading.set(false);
            return throwError(() => err);
          }),
          switchMap((conversation) => {
            this.conversation = this.conversationService.activeConversation;
            const message = {
              sender: sender,
              conversation: conversation._id,
              content: this.messageControl.value!,
              participants: conversation.participants.filter(
                (u) => u._id !== sender?._id
              ),
              type: MessageType.TEXT,
            };
            return this.messageService.sendMessage(message).pipe(
              catchError((err) => {
                toast.error('Something went wrong!', {
                  description: err.error.message,
                  duration: 5000,
                  position: 'bottom-right',
                });
                this.isLoading.set(false);
                return throwError(() => err);
              }),
              tap(() => {
                this.isLoading.set(false);
                this.messageControl.reset();
              })
            );
          })
        )
        .subscribe();
    } else {
      this.isLoading.set(true);

      const message = {
        sender: sender,
        conversation: convo._id,
        content: this.messageControl.value,
        participants: convo.participants.filter((u) => u._id !== sender?._id),
        type: MessageType.TEXT,
      };

      this.messageService
        .sendMessage(message)
        .pipe(
          catchError((err) => {
            toast.error('Something went wrong!', {
              description: err.error.message,
              duration: 5000,
              position: 'bottom-right',
            });
            this.isLoading.set(false);
            return throwError(() => err);
          }),
          tap(() => {
            this.conversation = this.conversationService.activeConversation;
            this.isLoading.set(false);
            this.messageControl.reset();
          })
        )
        .subscribe();
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMoreMessages() {
    if (this.isLoading() || !this.hasMoreMessages()) return;

    this.isLoading.set(true);

    const convo = this.conversation();
    if (!convo) return;

    this.messageService
      .getMessagesByConversationId(convo._id, this.offset(), this.limit)
      .pipe(
        tap((msgs) => {
          this.offset.set(this.offset() + this.limit);
          if (msgs.totalCount < this.offset()) {
            this.hasMoreMessages.set(false);
          }
        }),
        tap(() => this.isLoading.set(false))
      )
      .subscribe(() => this.isLoading.set(false));
  }

  onChatTopVisible(): void {
    console.log('top part visible');
    if (this.hasMoreMessages()) {
      this.loadMoreMessages();
    }
  }

  getMessageTime(currentIndex: number): string {
    const currentMessage = this.messages()[currentIndex];
    const currentTime = new Date(currentMessage.createdAt || '');

    // For the first message, always show the time
    if (currentIndex === 0) {
      return this.formatTime(currentTime);
    }

    // Compare with previous message
    const previousMessage = this.messages()[currentIndex - 1];
    const previousTime = new Date(previousMessage.createdAt || '');

    // Calculate time difference in milliseconds
    const timeDifference = previousTime.getTime() - currentTime.getTime();

    // If more than 15 minutes (900000 ms) have passed, show the time
    if (timeDifference > 15 * 60 * 1000) {
      return this.formatTime(currentTime);
    }

    return '';
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private trackTypingStatus(): void {
    this.messageControl.valueChanges
      .pipe(
        distinctUntilChanged((prev, curr) => Boolean(prev) === Boolean(curr)),
        takeUntil(this.destroy$),
        tap((query) => {
          const sender = this.currentUser();
          const convo = this.conversation();

          if (!sender || !convo) return;

          const data = {
            type: 'typing',
            sender,
            participants: convo.participants,
            is_typing: Boolean(query),
            conversation: convo._id,
          };
          this.webSocketService.sendMessage(data);
        })
      )
      .subscribe();
  }
}

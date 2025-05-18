import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  linkedSignal,
  OnInit,
  QueryList,
  Signal,
  signal,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import {
  catchError,
  debounceTime,
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
  GroupedMessages,
  MessageI,
  MessageStatus,
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
import { UserI } from '../../user/interfaces/user.interface';
import { toast } from 'ngx-sonner';
import { HlmToasterComponent } from '@spartan-ng/ui-sonner-helm';
import { ParticipantI } from '../interfaces/participant.interface';
import { TypingMessage } from '../interfaces/web-socket-message.interface';
import { TimeAgoPipe } from '../../../shared/pipes/time-ago.pipe';
import { MessageCardComponent } from '../message/message-card.component';

@Component({
  selector: 'app-chatbox',
  imports: [
    MessageCardComponent,

    TimeAgoPipe,

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
  styleUrl: './chatbox.component.css',
})
export class ChatboxComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userService = inject(UserService);
  private conversationService = inject(ConversationService);
  private messageService = inject(MessageService);
  private webSocketService = inject(WebSocketService);

  private readonly destroy$ = new Subject<void>();
  private readonly TIME_GAP_THRESHOLD: number = 15;

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
  groupedMessages = linkedSignal<GroupedMessages[]>(() => {
    let groupedMessages: GroupedMessages[] = [];
    const messages = this.messages();

    let currentGroup: MessageI[] = [];
    let lastTimestamp: Date | null = null;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (lastTimestamp) {
        const timeDifference =
          (lastTimestamp.getTime() - new Date(message.createdAt).getTime()) /
          (1000 * 60); // in minutes

        if (timeDifference >= this.TIME_GAP_THRESHOLD) {
          groupedMessages.push({
            timeframe: this.formatTimestamp(lastTimestamp.toISOString()), // Format the last timestamp of the group
            messages: currentGroup,
          });
          currentGroup = [];
        }
      }

      currentGroup.push(message);
      lastTimestamp = new Date(message.createdAt);
    }

    if (currentGroup.length > 0) {
      groupedMessages.push({
        timeframe: this.formatTimestamp(lastTimestamp?.toISOString() ?? ''), // Format the last timestamp of the group
        messages: currentGroup,
      });
    }
    return groupedMessages;
  });
  totalMessagesCount = signal<number>(0);

  messageControl = new FormControl<string>('');

  currentUser = this.userService.currentUser;
  selectedUser = this.conversationService.selectedUser;

  offset = signal<number>(0);
  limit = 20;
  hasMoreMessages = signal<boolean>(true);

  isLoading = signal<boolean>(false);
  isTyping = signal<{
    typer: Partial<ParticipantI>;
    is_typing: boolean;
  } | null>(null);

  @ViewChild('topTracker') observedElement?: ElementRef;
  @ViewChildren('messageItem') messageItems?: QueryList<ElementRef>;

  isVisible = signal<boolean>(false);
  isVisibilityObserving = signal<boolean>(false);

  private divTopObserver?: IntersectionObserver;
  private messageObserver?: IntersectionObserver;

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
              return this.loadMoreMessages(c._id).pipe(
                tap((messagesList) => {
                  const user = this.currentUser();
                  this.totalMessagesCount.set(messagesList.totalCount);
                  const duplicateIds = messagesList.messages.filter(
                    (id, index) => messagesList.messages.indexOf(id) !== index
                  );
                  if (duplicateIds.length > 0) {
                    console.warn('Duplicate _id values found:', duplicateIds);
                  }
                  if (messagesList.totalCount > this.offset()) {
                    this.hasMoreMessages.set(true);
                    this.offset.update((val) => val + this.limit);
                  } else {
                    this.hasMoreMessages.set(false);
                  }

                  if (user) {
                    const filteredMessages = messagesList.messages.filter((m) =>
                      m.readBy?.includes(user._id)
                    );
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
                        switch (res.type) {
                          case 'typing':
                            this.isTyping.set({
                              typer: res.sender ?? {},
                              is_typing: !!res.is_typing,
                            });
                            break;
                          case 'message':
                            const user = this.currentUser();
                            if (res.message.sender === user?._id) {
                              const savedMessage: MessageI = res.message;

                              this.messageService.fillInMessageDetails(
                                savedMessage
                              );

                              return;
                            }
                            const message: MessageI = res.message;

                            this.messageService.addMessage(message);
                            return;
                          case 'user-status':
                            const { userId, status } = res;

                            let { last_seen } = res;

                            if (!last_seen) {
                              last_seen = new Date().toISOString();
                            }

                            this.conversationService.updateParticipantStatus(
                              userId,
                              status,
                              last_seen
                            );
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

  ngAfterViewInit() {
    const observer = new IntersectionObserver(
      (entries) => {
        const readMessages = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.getAttribute('data-message-id'));

        if (readMessages.length > 0) {
          console.log(readMessages);
          // this.messageService.markMessagesAsRead(readMessages);
        }
      },
      { threshold: 0.5 }
    ); // Consider as read if 50% visible

    this.messageItems?.forEach((item) => {
      observer.observe(item.nativeElement);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.divTopObserver) {
      this.divTopObserver.disconnect();
    }
    if (this.messageObserver) {
      this.messageObserver.disconnect();
    }
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
            const message: MessageI = {
              sender: sender,
              conversation: conversation._id,
              content: this.messageControl.value!,
              type: MessageType.TEXT,
              status: MessageStatus.SENDING,
              createdAt: new Date().toISOString(),
            };

            const participants = conversation.participants.filter(
              (u) => u._id !== sender?._id
            );

            return this.messageService.sendMessage(message, participants).pipe(
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

      const message: MessageI = {
        sender: sender,
        conversation: convo._id,
        content: this.messageControl.value,
        type: MessageType.TEXT,
        status: MessageStatus.SENDING,
        createdAt: new Date().toISOString(),
      };
      const participants = convo.participants.filter(
        (u) => u._id !== sender?._id
      );

      this.messageService
        .sendMessage(message, participants)
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

  loadMoreMessages(conversationId: string) {
    if (!this.hasMoreMessages()) return EMPTY;

    this.isLoading.set(true);

    const convo = this.conversation();

    if (!conversationId) return EMPTY;

    return this.messageService
      .getMessagesByConversationId(conversationId, this.offset(), this.limit)
      .pipe(
        debounceTime(500),
        tap((msgs) => {
          this.offset.set(this.offset() + this.limit);
          if (msgs.totalCount > this.offset()) {
            this.hasMoreMessages.set(true);
            this.offset.update((val) => val + this.limit);
          } else {
            this.hasMoreMessages.set(false);
          }
          this.isLoading.set(false);
        })
      );
    // .subscribe();
  }

  onChatTopVisible(): void {
    if (this.observedElement && !this.isVisibilityObserving()) {
      this.isVisibilityObserving.set(true);
      this.divTopObserver = new IntersectionObserver(
        ([entry]) => {
          this.isVisible.set(entry.isIntersecting && !this.isLoading());
          if (this.hasMoreMessages() && this.isVisible()) {
            this.loadMoreMessages(
              String(this.conversation()?._id)
            )?.subscribe();
          }
          if (this.totalMessagesCount() < this.offset()) {
            this.divTopObserver?.disconnect();
          }
        },
        {
          threshold: 0.1, // 10% of the element must be visible to trigger
        }
      );

      this.divTopObserver.observe(this.observedElement.nativeElement);
    }
  }

  /**
   * Format the timestamp in a user-friendly way
   */
  formatTimestamp(isoString: string): string {
    if (!isoString) return '';

    const timestamp = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const messageDate = new Date(
      timestamp.getFullYear(),
      timestamp.getMonth(),
      timestamp.getDate()
    );

    // Format time component
    const timeFormat = new Intl.DateTimeFormat('en', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
    const timeString = timeFormat.format(timestamp);

    // Today's messages
    if (messageDate.getTime() === today.getTime()) {
      return timeString;
    }

    // Yesterday's messages
    if (messageDate.getTime() === yesterday.getTime()) {
      return `Yesterday at ${timeString}`;
    }

    // Older messages
    const dateFormat = new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
    });
    const dateString = dateFormat.format(timestamp);
    return `${dateString} at ${timeString}`;
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

          const data: TypingMessage = {
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

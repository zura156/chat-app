import {
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { MessageCardComponent } from '../card/message-card.component';
import { HlmSeparatorDirective } from '@spartan-ng/ui-separator-helm';
import { BrnSeparatorComponent } from '@spartan-ng/brain/separator';
import { HlmButtonDirective } from '@spartan-ng/ui-button-helm';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucidePencil } from '@ng-icons/lucide';
import { HlmIconDirective } from '@spartan-ng/ui-icon-helm';
import { MessageService } from '../services/message.service';
import { ConversationService } from '../services/conversation.service';
import { AuthService } from '../../auth/services/auth.service';
import { Observable, Subject, takeUntil, tap } from 'rxjs';
import { ConversationI } from '../interfaces/conversation.interface';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { MessageI } from '../interfaces/message.interface';
import { ParticipantI } from '../interfaces/participant.interface';
import { UserService } from '../../user/services/user.service';

@Component({
  selector: 'app-messages-list',
  imports: [
    MessageCardComponent,
    HlmSeparatorDirective,
    BrnSeparatorComponent,
    HlmButtonDirective,
    NgIcon,
    HlmIconDirective,
    NgIf,
    NgFor,
  ],
  providers: [provideIcons({ lucidePencil, lucideMenu })],
  templateUrl: './messages-list.component.html',
})
export class MessageListComponent implements OnInit {
  conversations = signal<ConversationI[]>([]);
  selectedConversation: ConversationI | undefined;
  userService = inject(UserService);

  constructor(private conversationService: ConversationService) {
    effect(() => {
      if (this.userService.currentUser()) {
        console.log(this.userService.currentUser())
        this.getConversations();
      }
    });
  }

  ngOnInit(): void {}

  // Function to fetch conversations
  getConversations(): void {
    // this.conversationService
    //   .getConversations(this.userService.currentUser()?._id ?? 'foo')
    //   .subscribe((conversations: ConversationI[]) => {
    //     this.conversations.set(conversations);
    //   });
  }

  // Function to select a conversation
  selectConversation(conversation: ConversationI): void {
    this.selectedConversation = conversation;
  }
}

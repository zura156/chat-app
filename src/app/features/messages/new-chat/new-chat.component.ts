import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../user/services/user.service';
import { ConversationService } from '../services/conversation.service';

@Component({
  selector: 'app-new-chat',
  imports: [],
  templateUrl: './new-chat.component.html',
})
export class NewChatComponent implements OnInit {
  route = inject(ActivatedRoute);
  router = inject(Router);
  userService = inject(UserService);
  conversationService = inject(ConversationService);

  ngOnInit(): void {}
}

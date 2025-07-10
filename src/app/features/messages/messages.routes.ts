import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './layout/messages-layout.component';
import { ChatboxComponent } from './chatbox/chatbox.component';
import { NewChatComponent } from './new-chat/new-chat.component';
import { LayoutService } from './layout/layout.service';
import { ConversationListComponent } from './list/conversation-list.component';
import { MessagesStartComponent } from './start/messages-start.compoent';

export const messagesRoutes: Routes = [
  {
    path: '',
    component: MessagesLayoutComponent,
    providers: [LayoutService],
    children: [
      {
        path: '',
        component: ConversationListComponent,
      },
      // {
      //   path: '',
      //   component: MessagesStartComponent,
      // },
      {
        path: 'new',
        component: NewChatComponent,
      },
      {
        path: ':id',
        component: ChatboxComponent,
      },
    ],
  },
];

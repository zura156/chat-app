import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './layout/messages-layout.component';
import { ChatboxComponent } from './chatbox/chatbox.component';
import { NewChatComponent } from './new-chat/new-chat.component';
import { LayoutService } from './layout/layout.service';

export const messagesRoutes: Routes = [
  {
    path: '',
    component: MessagesLayoutComponent,
    providers: [LayoutService],
    children: [
      {
        path: 'new',
        component: NewChatComponent,
      },
      {
        path: ':id',
        component: ChatboxComponent,
      },
      // { path: '', component: MessagesStartComponent, outlet: 'right' }, //Initial right side view.
      // {
      //   path: 'settings', // settings for specific chats. (e.g. mute, delete, theme, etc.)
      // },
    ],
  },
];

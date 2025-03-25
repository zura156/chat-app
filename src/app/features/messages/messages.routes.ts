import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './layout/messages-layout.component';
import { ChatboxComponent } from './chatbox/chatbox.component';
import { MessageListComponent } from './list/messages-list.component';
import { NewChatComponent } from './new-chat/new-chat.component';

export const messagesRoutes: Routes = [
  {
    path: '',
    component: MessagesLayoutComponent,
    children: [
      {
        path: '',
        component: MessageListComponent,
        outlet: 'left',
      },
      {
        path: ':id',
        component: ChatboxComponent,
        outlet: 'right',
      },
      {
        path: 'new-chat',
        component: NewChatComponent,
        outlet: 'right',
      },
      // { path: '', component: MessagesStartComponent, outlet: 'right' }, //Initial right side view.
      // {
      //   path: 'settings', // settings for specific chats. (e.g. mute, delete, theme, etc.)
      // },
    ],
  },
];

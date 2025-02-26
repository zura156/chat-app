import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './layout/messages-layout.component';
import { MessagesStartComponent } from './start/messages-start.compoent';
export const messagesRoutes: Routes = [
  {
    path: '',
    component: MessagesStartComponent,
  },
  {
    path: ':id',
    component: MessagesLayoutComponent,
    children: [
      {
        path: 'settings', // settings for specific chats. (e.g. mute, delete, theme, etc.)
      },
    ],
  },
  {
    path: 'new-chat', // create new chat
  },
];

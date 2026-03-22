import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './components/layout/messages-layout.component';
import { LayoutService } from './services/layout.service';
import { MediaViewerService } from '../../shared/services/media-viewer.service';
import { conversationsResolver } from './services/conversations.resolver';

export const messagesRoutes: Routes = [
  {
    path: '',
    title: 'Chat App',
    component: MessagesLayoutComponent,
    providers: [LayoutService],
    resolve: [conversationsResolver],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./components/list/conversation-list.component').then(
            (c) => c.ConversationListComponent,
          ),
      },
      {
        path: 'new',
        loadComponent: () =>
          import('./components/new-chat/new-chat.component').then(
            (c) => c.NewChatComponent,
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./components/chatbox/chatbox.component').then(
            (c) => c.ChatboxComponent,
          ),
        providers: [MediaViewerService],
      },
    ],
  },
];

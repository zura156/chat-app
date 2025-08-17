import { Routes } from '@angular/router';
import { MessagesLayoutComponent } from './layout/messages-layout.component';
import { LayoutService } from './layout/layout.service';
import { MediaViewerService } from '../../shared/services/media-viewer.service';

export const messagesRoutes: Routes = [
  {
    path: '',
    component: MessagesLayoutComponent,
    providers: [LayoutService],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./list/conversation-list.component').then(
            (c) => c.ConversationListComponent
          ),
      },
      {
        path: 'new',
        loadComponent: () =>
          import('./new-chat/new-chat.component').then(
            (c) => c.NewChatComponent
          ),
      },
      {
        path: ':id',
        loadComponent: () =>
          import('./chatbox/chatbox.component').then((c) => c.ChatboxComponent),
        providers: [MediaViewerService],
      },
    ],
  },
];

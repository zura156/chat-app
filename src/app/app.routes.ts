import { Routes } from '@angular/router';
import { MessageService } from './features/messages/services/message.service';
import { authGuard } from './features/auth/guards/auth.guard';
import { unauthenticatedGuard } from './features/auth/guards/unauthenticated.guard';
import { ConversationService } from './features/messages/services/conversation.service';
import { NotificationService } from './features/messages/services/notification.service';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
    canActivate: [unauthenticatedGuard],
  },
  {
    path: 'settings', // preference & user profile settings (e.g. display name, pfp, theme preferences, etc.)
    loadChildren: () =>
      import('./features/user/components/settings/settings.routes').then(
        (m) => m.settingsRoutes,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'messages',
    loadChildren: () =>
      import('./features/messages/messages.routes').then(
        (m) => m.messagesRoutes,
      ),
    providers: [MessageService, ConversationService, NotificationService],
    canActivate: [authGuard],
  },
  {
    path: ':id', // User page
    loadComponent: () =>
      import('./features/user/components/page/user-page.component').then(
        (c) => c.UserPageComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./shared/components/not-found/not-found.page').then(
        (c) => c.NotFoundPage,
      ),
  },
];

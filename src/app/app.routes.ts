import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { MessageService } from './features/messages/services/message.service';
import { RegisterComponent } from './features/auth/register/register.component';
import { authGuard } from './features/auth/guards/auth.guard';
import { unauthenticatedGuard } from './features/auth/guards/unauthenticated.guard';
import { ConversationService } from './features/messages/services/conversation.service';
import { NotificationService } from './features/messages/services/notification.service';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [unauthenticatedGuard],
  },
  {
    path: 'register',
    component: RegisterComponent,
    canActivate: [unauthenticatedGuard],
  },
  {
    path: 'settings', // preference & user profile settings (e.g. display name, pfp, theme preferences, etc.)
    loadChildren: () =>
      import('./features/user/components/settings/settings.routes').then(
        (m) => m.settingsRoutes
      ),
    canActivate: [authGuard],
  },
  {
    path: 'messages',
    loadChildren: () =>
      import('./features/messages/messages.routes').then(
        (m) => m.messagesRoutes
      ),
    providers: [MessageService, ConversationService, NotificationService],
    canActivate: [authGuard],
  },
  {
    path: ':id', // User page
    loadComponent: () =>
      import('./features/user/components/page/user-page.component').then(
        (c) => c.UserPageComponent
      ),
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];

import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { MessageService } from './features/messages/services/message.service';
import { RegisterComponent } from './features/auth/register/register.component';
import { authGuard } from './features/auth/guards/auth.guard';
import { unauthenticatedGuard } from './features/auth/guards/unauthenticated.guard';
import { ConversationService } from './features/messages/services/conversation.service';

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
  // {
  //   path: 'profile', // profile preference settings for the user (e.g. display name, profile picture, etc.)
  // },
  {
    path: 'messages',
    loadChildren: () =>
      import('./features/messages/messages.routes').then(
        (m) => m.messagesRoutes
      ),
    providers: [MessageService, ConversationService],
    canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];

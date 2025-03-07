import { Routes } from '@angular/router';
import { LoginComponent } from './features/auth/login/login.component';
import { MessageService } from './features/messages/services/message.service';
import { RegisterComponent } from './features/auth/register/register.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    component: LoginComponent,
    // canActivate: [!authGuard],
  },
  {
    path: 'register',
    component: RegisterComponent,
    // canActivate: [!authGuard],
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
    providers: [MessageService],
    // canActivate: [authGuard],
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];

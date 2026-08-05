import { Routes } from '@angular/router';
import { MessageService } from './features/messages/services/message.service';
import { authGuard } from './features/auth/guards/auth.guard';
import { ConversationService } from './features/messages/services/conversation.service';
import { MessageActionsService } from './features/messages/services/message-actions.service';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full',
  },
  {
    /*
     * The unauthenticated guard is applied per child, not here.
     *
     * Guarding the whole subtree meant every route under /auth redirected a
     * signed-in user to /messages — including the ones that exist to redeem a
     * link from an email. Verifying an address, confirming an address change,
     * resetting a password and unlocking an account are all things you do while
     * signed in, and all of them silently bounced. Only the pages that make no
     * sense with a session — login and register — actually want the guard.
     */
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
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
    providers: [MessageService, ConversationService, MessageActionsService],
    canActivate: [authGuard],
  },
  {
    /*
     * Namespaced under /u/.
     *
     * This was a bare `:id` at the root, which matches *any* single-segment
     * path — so every mistyped URL rendered a user page for a nonsense id
     * instead of the not-found component, and the route permanently shadowed
     * any future top-level page.
     */
    path: 'u/:id',
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

import { Routes } from '@angular/router';
import { SignupComponent } from './features/auth/components/signup/signup.component';
import { SigninComponent } from './features/auth/components/signin/signin.component';
import { ChatService } from './features/chat/services/chat.service';
import { ChatPageComponent } from './features/chat/components/chat-page/chat-page.component';
import { authGuard } from './features/auth/guards/auth.guard';
import { chatGuard } from './features/chat/guards/chat.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'chat',
    pathMatch: 'full',
  },
  { path: 'signin', component: SigninComponent, canActivate: [authGuard] },
  { path: 'signup', component: SignupComponent, canActivate: [authGuard] },
  {
    path: 'chat',
    component: ChatPageComponent,
    canActivate: [chatGuard],
    providers: [ChatService],
  },
];

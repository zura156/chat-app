import { Routes } from '@angular/router';
import { SignupComponent } from './features/auth/components/signup/signup.component';
import { SigninComponent } from './features/auth/components/signin/signin.component';
import { ChatService } from './features/chat/services/chat.service';
import { ChatPageComponent } from './features/chat/components/chat-page/chat-page.component';

export const routes: Routes = [
  { path: 'signin', component: SigninComponent },
  { path: 'signup', component: SignupComponent },
  { path: 'chat', component: ChatPageComponent, providers: [ChatService] },
];

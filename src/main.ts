import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { initializeApp } from 'firebase/app';
import { environment } from './environments/environment';

const firebaseConfig = {
  apiKey: environment.firebaseAPIKey,
  authDomain: 'chat-app-get-stream.firebaseapp.com',
  projectId: 'chat-app-get-stream',
  storageBucket: 'chat-app-get-stream.firebasestorage.app',
  messagingSenderId: '19448914697',
  appId: '1:19448914697:web:30d6c0829358d5b19c29d8',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err)
);

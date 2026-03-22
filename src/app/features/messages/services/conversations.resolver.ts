import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, EMPTY, of } from 'rxjs';
import { ConversationService } from './conversation.service'; // adjust path

export const conversationsResolver: ResolveFn<unknown> = () => {
  const conversationService = inject(ConversationService);

  if (conversationService.conversationList()?.conversations?.length) {
    return of(conversationService.conversationList());
  }

  return conversationService.getConversations().pipe(catchError(() => EMPTY));
};

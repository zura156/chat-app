import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ConversationService } from './conversation.service'; // adjust path

export const conversationsResolver: ResolveFn<unknown> = () => {
  const conversationService = inject(ConversationService);

  if (conversationService.conversationList()?.conversations?.length) {
    return of(conversationService.conversationList());
  }

  /*
   * `of(null)`, never EMPTY.
   *
   * A resolver that completes without emitting *cancels the navigation* — the
   * router abandons the route and leaves whatever was on screen, which during a
   * first load is nothing at all. So any failure to fetch conversations (an
   * expired session, a 500, a dropped connection) produced a blank page rather
   * than a chat list that happened to be empty.
   *
   * The list is a signal the layout reads directly; the resolver only exists to
   * front-load the request. It has no result the route depends on, so a failure
   * here must not be able to block rendering.
   */
  return conversationService.getConversations().pipe(catchError(() => of(null)));
};

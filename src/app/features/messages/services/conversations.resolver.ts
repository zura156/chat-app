import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ConversationService } from './conversation.service'; // adjust path

export const conversationsResolver: ResolveFn<unknown> = () => {
  const conversationService = inject(ConversationService);

  /*
   * The cached list is shown immediately *and* revalidated.
   *
   * Returning the cache and stopping meant conversations started by other
   * people while the user was elsewhere never appeared: nothing refetched, and
   * an incoming message for an unknown conversation only reaches
   * `setLastMessageInConversation`, which maps over the ones already present
   * and silently does nothing. The request is fired without being awaited, so
   * the route still resolves instantly off the cache.
   */
  if (conversationService.conversationList()?.conversations?.length) {
    conversationService
      .getConversations()
      .pipe(catchError(() => of(null)))
      .subscribe();
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

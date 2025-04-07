import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, of, tap, catchError, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ConversationI } from '../interfaces/conversation.interface';
import { MessageI } from '../interfaces/message.interface';

interface ConversationListResponse {
  conversations: ConversationI[];
  total: number;
}

@Injectable()
export class ConversationService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // API endpoints
  private readonly GET_CONVERSATIONS_URL = `${this.apiUrl}/message/conversation`;
  private readonly SEARCH_CONVERSATIONS_URL = `${this.apiUrl}/message/conversation/search`;
  private readonly CREATE_CONVERSATION_URL = `${this.apiUrl}/message/conversation`;
  private readonly GET_CONVERSATION_URL = `${this.apiUrl}/message/conversation`;

  // Cache for active conversation data (messages, etc.)
  private conversationCache = new Map<
    string,
    {
      data: any;
      timestamp: number;
      request$?: Observable<any>;
    }
  >();

  // Cache duration in milliseconds (5 minutes)
  private readonly CACHE_DURATION = 5 * 60 * 1000;

  // Get a single conversation with messages
  getConversationById(id: string): Observable<ConversationI> {
    const url = `${this.GET_CONVERSATION_URL}/${id}`;
    const cacheKey = `conversation_${id}`;

    // Check cache
    const cachedData = this.conversationCache.get(cacheKey);
    const currentTime = Date.now();

    // Return cached data if valid
    if (
      cachedData &&
      currentTime - cachedData.timestamp < this.CACHE_DURATION &&
      !cachedData.request$
    ) {
      return of(cachedData.data);
    }

    // If there's an ongoing request, return that
    if (cachedData?.request$) {
      return cachedData.request$;
    }

    // Make new request
    const request$ = this.http.get<ConversationI>(url).pipe(
      tap((data) => {
        this.conversationCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
          request$: undefined,
        });
      }),
      catchError((error) => {
        this.conversationCache.delete(cacheKey);
        throw error;
      }),
      shareReplay(1)
    );

    // Store the request in cache while it's in progress
    this.conversationCache.set(cacheKey, {
      data: null,
      timestamp: 0,
      request$,
    });

    return request$;
  }

  // Get all conversations (inbox)
  getConversations(): Observable<ConversationListResponse> {
    const cacheKey = 'all_conversations';
    const cachedData = this.conversationCache.get(cacheKey);
    const currentTime = Date.now();

    if (
      cachedData &&
      currentTime - cachedData.timestamp < this.CACHE_DURATION &&
      !cachedData.request$
    ) {
      return of(cachedData.data);
    }

    if (cachedData?.request$) {
      return cachedData.request$;
    }

    const request$ = this.http
      .get<ConversationListResponse>(this.GET_CONVERSATIONS_URL)
      .pipe(
        tap((data) => {
          this.conversationCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            request$: undefined,
          });
        }),
        catchError((error) => {
          this.conversationCache.delete(cacheKey);
          throw error;
        }),
        shareReplay(1)
      );

    this.conversationCache.set(cacheKey, {
      data: null,
      timestamp: 0,
      request$,
    });

    return request$;
  }

  // Search conversations
  searchConversations(query: string): Observable<ConversationListResponse> {
    const url = `${this.SEARCH_CONVERSATIONS_URL}?q=${encodeURIComponent(
      query
    )}`;
    const cacheKey = `search_${query}`;

    const cachedData = this.conversationCache.get(cacheKey);
    const currentTime = Date.now();

    // Use a shorter cache duration for search results
    const searchCacheDuration = 60 * 1000; // 1 minute

    if (
      cachedData &&
      currentTime - cachedData.timestamp < searchCacheDuration &&
      !cachedData.request$
    ) {
      return of(cachedData.data);
    }

    if (cachedData?.request$) {
      return cachedData.request$;
    }

    const request$ = this.http.get<ConversationListResponse>(url).pipe(
      tap((data) => {
        this.conversationCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
          request$: undefined,
        });
      }),
      catchError((error) => {
        this.conversationCache.delete(cacheKey);
        throw error;
      }),
      shareReplay(1)
    );

    this.conversationCache.set(cacheKey, {
      data: null,
      timestamp: 0,
      request$,
    });

    return request$;
  }

  // Create a new conversation
  createConversation(
    participants: string[],
    isGroup: boolean = false,
    groupName?: string
  ): Observable<ConversationI> {
    const payload = {
      participants,
      is_group: isGroup,
      group_name: groupName,
    };

    return this.http
      .post<ConversationI>(this.CREATE_CONVERSATION_URL, {
        conversation: payload,
      })
      .pipe(
        tap((newConversation) => {
          const cacheKey = 'conversation_' + newConversation._id;
          this.conversationCache.set(cacheKey, {
            data: newConversation,
            timestamp: Date.now(),
            request$: undefined,
          });
        })
      );
  }

  // Send a message to a conversation
  sendMessage(
    conversationId: string,
    content: string,
    type: string = 'text'
  ): Observable<MessageI> {
    const url = `${this.GET_CONVERSATION_URL}/${conversationId}/messages`;
    const payload = {
      content,
      type,
    };

    return this.http.post<MessageI>(url, payload).pipe(
      tap(() => {
        // Invalidate the specific conversation cache
        this.conversationCache.delete(`conversation_${conversationId}`);
      })
    );
  }

  // Helper to clear all cache
  clearCache(): void {
    this.conversationCache.clear();
  }

  // Helper to invalidate specific conversation's cache
  invalidateConversation(conversationId: string): void {
    this.conversationCache.delete(`conversation_${conversationId}`);
  }
}

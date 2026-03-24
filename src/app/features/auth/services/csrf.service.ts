import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CSRFService {
  getTokenFromCookie(): string | null {
    const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

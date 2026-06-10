import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ErudaService {
  init() {
    if (!environment.production) {
      import('eruda').then((e) => e.default.init());
    }
  }
}

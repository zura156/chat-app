import { computed, Injectable, signal } from '@angular/core';

@Injectable()
export class LayoutService {
  #isRightView = signal<boolean>(false);
  isRightView = computed(this.#isRightView);

  #activeView = signal<'conversations' | 'users' | 'chatbox'>('conversations');
  activeView = computed(this.#activeView);

  switchView(): void {
    this.#isRightView.update((val) => !val);
  }

  setActiveView(view: 'conversations' | 'users' | 'chatbox'): void {
    this.#activeView.set(view);
  }
}

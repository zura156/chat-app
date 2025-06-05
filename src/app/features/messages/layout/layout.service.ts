import { computed, Injectable, linkedSignal, signal } from '@angular/core';
import { ActiveViewType } from '../interfaces/active-view.type';

@Injectable()
export class LayoutService {
  #isRightView = linkedSignal<boolean>(() => {
    const activeView = this.activeView();

    switch (activeView) {
      case 'conversations':
      case 'users':
        return false;
      case 'chatbox':
      case 'chatbox-settings':
        return true;
      default:
        return false;
    }
  });
  isRightView = computed(this.#isRightView);

  #activeView = signal<ActiveViewType>('conversations');
  activeView = computed(this.#activeView);

  setActiveView(view: ActiveViewType): void {
    this.#activeView.set(view);
  }
}

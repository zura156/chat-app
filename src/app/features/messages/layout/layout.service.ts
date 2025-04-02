import { computed, Injectable, signal } from '@angular/core';

@Injectable()
export class LayoutService {
  #isRightView = signal<boolean>(false);

  isRightView = computed(this.#isRightView);

  switchView() {
    this.#isRightView.update((val) => !val);
  }
}

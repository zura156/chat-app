import { Component, computed, input } from '@angular/core';
import { LEGAL, LegalFact, legalFactLabel } from '../../legal.config';

/**
 * One operator fact inside running legal text — the value from `LEGAL`, or a
 * marker that cannot be mistaken for it. The contact address renders as a
 * mailto link, because every place a policy names it, the reader's next step
 * is to write to it.
 */
@Component({
  selector: 'app-legal-fact',
  template: `
    @let text = value();
    @if (!text) {
      <mark class="legal-fact-missing">[{{ label() }} not set]</mark>
    } @else if (fact() === 'contactEmail') {
      <a [href]="'mailto:' + text">{{ text }}</a>
    } @else {
      {{ text }}
    }
  `,
  styles: `
    .legal-fact-missing {
      background: color-mix(in oklch, var(--destructive) 18%, transparent);
      color: inherit;
      border-radius: 0.25rem;
      padding: 0 0.25rem;
      font-weight: 500;
    }
  `,
})
export class LegalFactComponent {
  readonly fact = input.required<LegalFact>();

  protected readonly value = computed(() => LEGAL[this.fact()].trim());
  protected readonly label = computed(() => legalFactLabel(this.fact()));
}

import { Pipe, PipeTransform, signal } from '@angular/core';

/**
 * Shared clock driving every `timeAgo` on screen.
 */
const now = signal(Date.now());

/** One interval for the whole app, started lazily and never duplicated. */
let ticking = false;
const startClock = (): void => {
  if (ticking || typeof window === 'undefined') return;
  ticking = true;
  // 30s: the shortest bucket below is a minute, so anything finer is wasted
  // change detection.
  setInterval(() => now.set(Date.now()), 30_000);
};

@Pipe({
  name: 'timeAgo',
  pure: false,
})
export class TimeAgoPipe implements PipeTransform {
  constructor() {
    startClock();
  }

  transform(value: Date | string | number): string {
    if (!value) return '';

    const then = new Date(value);
    if (Number.isNaN(+then)) return '';

    const seconds = Math.floor((now() - +then) / 1000);

    // Clock skew between client and server puts fresh messages slightly in the
    // future; every interval then yields 0 and the old code fell through to
    // printing the raw timestamp.
    if (seconds < 29) return 'just now';

    const intervals: { [key: string]: number } = {
      yr: 31536000,
      mo: 2592000,
      w: 604800,
      d: 86400,
      h: 3600,
      m: 60,
      s: 1,
    };

    for (const i in intervals) {
      const counter = Math.floor(seconds / intervals[i]);
      if (counter > 0) return `${counter}${i} ago`;
    }

    return value.toString();
  }
}

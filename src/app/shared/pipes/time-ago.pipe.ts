import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'timeAgo',
})
export class TimeAgoPipe implements PipeTransform {
  transform(value: Date | string | number): string {
    if (!value) return '';

    const now = new Date();
    const then = new Date(value);
    const seconds = Math.floor((+now - +then) / 1000);

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

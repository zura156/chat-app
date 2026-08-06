import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatTime',
})
export class FormatTimePipe implements PipeTransform {
  transform(totalSeconds: number): string {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '0:00';

    totalSeconds = Math.floor(totalSeconds);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    let result = `${paddedMinutes}:${paddedSeconds}`;

    /*
     * Once there is a days field the hours field has to appear too, even at
     * zero. Keying it on `hours >= 1` alone dropped the component entirely for
     * any duration that lands on a whole number of days: 86400s rendered as
     * "1d 00:00", which reads as a day and no minutes, and 1d 0h 5m rendered
     * as "1d 05:00" — indistinguishable from five minutes past the day.
     */
    if (hours >= 1 || days >= 1) {
      result = `${hours}:${result}`;
    }

    if (days >= 1) {
      result = `${days}d ${result}`;
    }

    return result;
  }
}

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

    if (hours >= 1) {
      result = `${hours}:${result}`;
    }

    if (days >= 1) {
      result = `${days}d ${result}`;
    }

    return result;
  }
}

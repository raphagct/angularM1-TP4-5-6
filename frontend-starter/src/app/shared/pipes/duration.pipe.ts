import { Pipe, PipeTransform } from '@angular/core';
import { formatDuration } from '../utils/audio';

/** Displays a duration in seconds as m:ss (or h:mm:ss). */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(seconds: number | null | undefined): string {
    return formatDuration(seconds);
  }
}

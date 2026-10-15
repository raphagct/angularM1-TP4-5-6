import { describe, it, expect } from 'vitest';
import { DurationPipe } from './duration.pipe';

describe('DurationPipe', () => {
  const pipe = new DurationPipe();

  it('formate une durée en m:ss', () => {
    expect(pipe.transform(185)).toBe('3:05');
  });

  it('affiche --:-- quand la durée est inconnue', () => {
    expect(pipe.transform(undefined)).toBe('--:--');
    expect(pipe.transform(null)).toBe('--:--');
  });
});

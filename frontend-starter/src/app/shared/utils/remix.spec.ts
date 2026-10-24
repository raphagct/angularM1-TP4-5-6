import { describe, it, expect } from 'vitest';
import { encodeMp3, mixRemix, timeStretch } from './remix';

const RATE = 44100;

/** One second (by default) of a sine wave at `frequency` Hz. */
const sine = (frequency: number, seconds = 1, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE));

/** Estimates the frequency from the rising zero crossings, away from the edges. */
const frequencyOf = (samples: Float32Array) => {
  const from = Math.floor(samples.length * 0.2);
  const to = Math.floor(samples.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return (crossings * RATE) / (to - from);
};

const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);

describe('timeStretch', () => {
  it.each([1.25, 0.8])('change la durée (×%s) sans changer la hauteur', (rate) => {
    const [out] = timeStretch([sine(440)], rate);
    expect(out.length).toBe(Math.floor(RATE / rate));
    expect(frequencyOf(out)).toBeCloseTo(440, -1);
    // Les fenêtres s'additionnent en phase : le volume est conservé.
    expect(rms(out.subarray(4096, out.length - 4096))).toBeCloseTo(0.5 / Math.SQRT2, 1);
  });

  it('applique les mêmes décalages à tous les canaux', () => {
    const [left, right] = timeStretch([sine(220), sine(220)], 1.1);
    expect(right).toEqual(left);
  });

  it('copie le signal quand le tempo ne change pas', () => {
    const input = sine(100, 0.1);
    const [out] = timeStretch([input], 1);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('accepte un signal vide', () => {
    expect(timeStretch([new Float32Array(0)], 1.5)[0]).toHaveLength(0);
    expect(timeStretch([], 1.5)).toEqual([]);
  });
});

describe('mixRemix', () => {
  const settings = { vocalsVolume: 1, beatVolume: 1, beatSpeed: 1, beatStart: 0 };

  it('dure autant que la voix et applique les volumes', () => {
    const vocals = [new Float32Array(100).fill(0.2)];
    const beat = [new Float32Array(1000).fill(0.4)];
    const [left, right] = mixRemix(vocals, beat, RATE, { ...settings, vocalsVolume: 0.5, beatVolume: 0.5 });
    expect(left).toHaveLength(100);
    expect(left[50]).toBeCloseTo(0.1 + 0.2);
    // Une voix mono est jouée sur les deux canaux.
    expect(right).toEqual(left);
  });

  it('démarre la prod à « Début prod »', () => {
    const beat = [Float32Array.from({ length: RATE * 2 }, (_, i) => (i >= RATE ? 0.5 : 0))];
    const [left] = mixRemix([new Float32Array(100)], beat, RATE, { ...settings, beatStart: 1 });
    expect(left[10]).toBeCloseTo(0.5);
  });

  it('laisse la voix seule quand la prod est terminée', () => {
    const [left] = mixRemix([new Float32Array(200).fill(0.3)], [new Float32Array(50).fill(0.3)], RATE, settings);
    expect(left[10]).toBeCloseTo(0.6);
    expect(left[150]).toBeCloseTo(0.3);
  });

  it('baisse le niveau au lieu de saturer', () => {
    const [left] = mixRemix([new Float32Array(10).fill(0.9)], [new Float32Array(10).fill(0.9)], RATE, settings);
    expect(Math.max(...left)).toBeCloseTo(0.98);
  });

  it('étire la prod au tempo demandé', () => {
    const [left] = mixRemix([new Float32Array(RATE)], [sine(400, 3)], RATE, { ...settings, beatSpeed: 1.25 });
    expect(frequencyOf(left)).toBeCloseTo(400, -1);
  });
});

describe('encodeMp3', () => {
  it('produit un MP3 dont la taille correspond au débit', async () => {
    const mp3 = await encodeMp3([sine(440, 2), sine(440, 2)], RATE, 192);
    expect(mp3.type).toBe('audio/mpeg');
    // 2 s à 192 kbps ≈ 48 Ko.
    expect(mp3.size).toBeGreaterThan(40_000);
    expect(mp3.size).toBeLessThan(56_000);
    // Chaque trame MP3 commence par 11 bits à 1 (synchronisation).
    const bytes = new Uint8Array(await mp3.arrayBuffer());
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1] & 0xe0).toBe(0xe0);
  });
});

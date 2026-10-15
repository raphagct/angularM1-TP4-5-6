import { describe, it, expect, vi } from 'vitest';
import {
  computePeaks,
  drawWaveform,
  formatDuration,
  fractionFromPointer,
  normalizePeaks,
  resamplePeaks,
  WaveformContext,
  WaveformDrawOptions,
} from './audio';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3725, '1:02:05'],
  ])('formate %s secondes en %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([undefined, null, NaN, Infinity, -1])('affiche --:-- pour %s', (value) => {
    expect(formatDuration(value)).toBe('--:--');
  });
});

describe('normalizePeaks', () => {
  it('ramène le pic le plus haut à 1', () => {
    expect(normalizePeaks([0.1, 0.5, 0.25])).toEqual([0.2, 1, 0.5]);
  });

  it('laisse le silence à 0 sans diviser par zéro', () => {
    expect(normalizePeaks([0, 0])).toEqual([0, 0]);
  });
});

describe('computePeaks', () => {
  it('garde le maximum absolu de chaque tranche', () => {
    // Valeurs exactement représentables en Float32 pour comparer sans arrondi.
    const samples = new Float32Array([0.25, -0.5, 0.125, 0.25, -0.125, 0.0625]);
    expect(computePeaks([samples], 3)).toEqual([1, 0.5, 0.25]);
  });

  it('combine les canaux en gardant le plus fort', () => {
    const left = new Float32Array([0.1, 0.1]);
    const right = new Float32Array([0.4, -0.2]);
    expect(computePeaks([left, right], 2)).toEqual([1, 0.5]);
  });

  it('gère plus de barres que d’échantillons', () => {
    const peaks = computePeaks([new Float32Array([1, 0.5])], 4);
    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks)).toBe(1);
  });

  it('retourne un tableau vide sans données ou sans barres', () => {
    expect(computePeaks([], 10)).toEqual([]);
    expect(computePeaks([new Float32Array(0)], 10)).toEqual([]);
    expect(computePeaks([new Float32Array([1])], 0)).toEqual([]);
  });
});

describe('resamplePeaks', () => {
  it('réduit en gardant le maximum de chaque groupe', () => {
    expect(resamplePeaks([0.1, 0.9, 0.3, 0.4], 2)).toEqual([0.9, 0.4]);
  });

  it('agrandit en répétant les valeurs', () => {
    expect(resamplePeaks([0.2, 0.8], 4)).toEqual([0.2, 0.2, 0.8, 0.8]);
  });

  it('retourne un tableau vide pour 0 barre ou aucun pic', () => {
    expect(resamplePeaks([1], 0)).toEqual([]);
    expect(resamplePeaks([], 5)).toEqual([]);
  });
});

describe('fractionFromPointer', () => {
  const rect = { left: 100, width: 200 };

  it('convertit une position X en fraction', () => {
    expect(fractionFromPointer(150, rect)).toBe(0.25);
  });

  it('borne le résultat entre 0 et 1', () => {
    expect(fractionFromPointer(50, rect)).toBe(0);
    expect(fractionFromPointer(400, rect)).toBe(1);
  });

  it('retourne 0 si l’élément n’a pas de largeur', () => {
    expect(fractionFromPointer(150, { left: 0, width: 0 })).toBe(0);
  });
});

describe('drawWaveform', () => {
  const colors = { played: 'green', hover: 'light', idle: 'grey' };
  const options = (overrides: Partial<WaveformDrawOptions> = {}): WaveformDrawOptions => ({
    width: 40,
    height: 100,
    progress: 0,
    hover: null,
    barWidth: 3,
    gap: 1,
    colors,
    ...overrides,
  });
  const fakeContext = () => ({ clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalAlpha: 1 }) as unknown as WaveformContext & {
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
  };

  it('efface puis dessine une barre et son reflet par colonne', () => {
    const ctx = fakeContext();
    const bars = drawWaveform(ctx, [1, 0.5], options());
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 40, 100);
    expect(bars).toHaveLength(10);
    expect(ctx.fillRect).toHaveBeenCalledTimes(20);
    // Première barre : pic 1, ligne de base à 70 % → hauteur 70 depuis y=0.
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 0, 0, 3, 70);
    // Reflet sous la ligne de base.
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 0, 71, 3, 29);
  });

  it('colore en vert les barres déjà jouées', () => {
    const bars = drawWaveform(fakeContext(), [1], options({ progress: 0.5 }));
    expect(bars.slice(0, 5)).toEqual(Array(5).fill('green'));
    expect(bars.slice(5)).toEqual(Array(5).fill('grey'));
  });

  it('prévisualise la zone survolée après la progression', () => {
    const bars = drawWaveform(fakeContext(), [1], options({ progress: 0.2, hover: 0.6 }));
    expect(bars.filter((c) => c === 'green')).toHaveLength(2);
    expect(bars.filter((c) => c === 'light')).toHaveLength(4);
    expect(bars.filter((c) => c === 'grey')).toHaveLength(4);
  });

  it('dessine au moins 1 px pour le silence', () => {
    const ctx = fakeContext();
    drawWaveform(ctx, [0], options({ width: 3 }));
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 0, 69, 3, 1);
  });

  it('ne dessine rien sans pics', () => {
    const ctx = fakeContext();
    expect(drawWaveform(ctx, [], options())).toEqual([]);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});

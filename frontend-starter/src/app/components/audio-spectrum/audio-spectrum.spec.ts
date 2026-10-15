import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSpectrumComponent } from './audio-spectrum';

describe('AudioSpectrumComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dessine les niveaux de fréquence pendant la lecture', async () => {
    const fillRect = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ clearRect: vi.fn(), fillRect, fillStyle: '' } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.stubGlobal('AudioContext', class {
      destination = {};
      createAnalyser() {
        return {
          fftSize: 0,
          frequencyBinCount: 128,
          getByteFrequencyData(values: Uint8Array) { values.fill(128); },
          connect() {},
        };
      }
      createMediaElementSource() { return { connect() {} }; }
      async resume() {}
      async close() {}
    });
    const fixture = TestBed.createComponent(AudioSpectrumComponent);
    fixture.componentRef.setInput('src', 'blob:example');
    fixture.componentRef.setInput('title', 'Exemple');
    fixture.detectChanges();
    await fixture.componentInstance.onPlay();
    expect(fillRect).toHaveBeenCalledTimes(48);
    expect(fixture.nativeElement.querySelector('canvas').getAttribute('aria-label'))
      .toBe('Spectre des fréquences de Exemple');
    fixture.destroy();
    getContext.mockRestore();
  });
});

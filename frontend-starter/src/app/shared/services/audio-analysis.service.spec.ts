import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioAnalysisService } from './audio-analysis.service';

describe('AudioAnalysisService', () => {
  let service: AudioAnalysisService;
  const decodeAudioData = vi.fn();

  beforeEach(() => {
    decodeAudioData.mockReset();
    // jsdom ne fournit pas la Web Audio API : on simule OfflineAudioContext.
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        decodeAudioData = decodeAudioData;
      },
    );
    service = TestBed.inject(AudioAnalysisService);
  });

  afterEach(() => vi.unstubAllGlobals());

  const blob = (buffer = new ArrayBuffer(4)) => ({ arrayBuffer: async () => buffer }) as unknown as Blob;

  it('décode le blob et calcule des pics normalisés sur tous les canaux', async () => {
    const raw = new ArrayBuffer(4);
    decodeAudioData.mockResolvedValue({
      duration: 1,
      numberOfChannels: 2,
      getChannelData: (i: number) => (i === 0 ? new Float32Array([0.1, 0.2, 0.1, 0.1]) : new Float32Array([0, 0, 0, -0.4])),
    });

    const peaks = await service.peaks(blob(raw), 2);

    expect(decodeAudioData).toHaveBeenCalledWith(raw);
    expect(peaks).toEqual([0.5, 1]);
  });

  it('utilise 1000 pics par défaut', async () => {
    decodeAudioData.mockResolvedValue({
      duration: 1,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(5000).fill(0.5),
    });
    expect(await service.peaks(blob())).toHaveLength(1000);
  });

  it('propage une erreur de décodage', async () => {
    decodeAudioData.mockRejectedValue(new DOMException('bad', 'EncodingError'));
    await expect(service.peaks(blob())).rejects.toThrow('bad');
  });
});

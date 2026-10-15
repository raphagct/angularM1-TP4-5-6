import { Injectable } from '@angular/core';
import { computePeaks } from '../utils/audio';

/** Number of peaks kept after decoding; the waveform resamples them to its width. */
export const PEAK_RESOLUTION = 1000;

/** Decodes audio in the browser with the Web Audio API to build a waveform. */
@Injectable({ providedIn: 'root' })
export class AudioAnalysisService {
  /**
   * Decodes the blob and returns normalized peaks between 0 and 1.
   * An OfflineAudioContext is used because it never plays sound and is not
   * subject to the browser autoplay policy.
   */
  async peaks(blob: Blob, count = PEAK_RESOLUTION): Promise<number[]> {
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    console.debug('[AudioAnalysis] Audio décodé', buffer.duration.toFixed(1), 's');
    return computePeaks(channels, count);
  }
}

import { Injectable } from '@angular/core';
import type { RemixSettings } from '../utils/remix';

/** Both sources are resampled to this rate before being mixed. */
export const REMIX_SAMPLE_RATE = 44100;

/** Renders the remix to an MP3 file in the browser, without playing it. */
@Injectable({ providedIn: 'root' })
export class RemixRenderService {
  async render(vocals: Blob, beat: Blob, settings: RemixSettings): Promise<Blob> {
    // The MP3 encoder is downloaded only the first time a remix is saved.
    const { encodeMp3, mixRemix } = await import('../utils/remix');
    // An OfflineAudioContext only decodes here: it never plays sound.
    const context = new OfflineAudioContext(2, 1, REMIX_SAMPLE_RATE);
    const decode = async (blob: Blob) => {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    };
    const [voice, prod] = await Promise.all([decode(vocals), decode(beat)]);
    console.debug('[RemixRender] Sources décodées');
    const mix = mixRemix(voice, prod, REMIX_SAMPLE_RATE, settings);
    const mp3 = await encodeMp3(mix, REMIX_SAMPLE_RATE);
    console.debug('[RemixRender] Remix encodé', mp3.size, 'octets');
    return mp3;
  }
}

import { Mp3Encoder } from '@breezystack/lamejs';

/** Settings of the remix panel: same meaning as in the live preview. */
export interface RemixSettings {
  vocalsVolume: number;
  beatVolume: number;
  /** Tempo of the beat; the pitch is kept. */
  beatSpeed: number;
  /** Position in the beat (seconds) where the vocals start. */
  beatStart: number;
}

// WSOLA parameters: ~46 ms frames at 44.1 kHz with 50 % overlap.
const FRAME = 2048;
const HOP = FRAME / 2;
/** How far (in samples) a frame may move to line up with the previous one. */
const TOLERANCE = 512;
/** The similarity search skips samples: 4× faster, still sub-millisecond. */
const STEP = 4;

/** Periodic Hann window: with a 50 % overlap, consecutive windows sum to 1. */
function hann(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

function toMono(channels: Float32Array[]): Float32Array {
  const mono = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length;
  return mono;
}

/**
 * Finds, around `nominal`, the input position whose start looks most like
 * `natural` (the continuation of the previous frame), so the overlap adds
 * up in phase instead of cancelling out.
 */
function bestPosition(mono: Float32Array, natural: number, nominal: number): number {
  if (natural + HOP > mono.length) return nominal;
  let best = nominal;
  let bestScore = -Infinity;
  for (let delta = -TOLERANCE; delta <= TOLERANCE; delta += STEP) {
    const candidate = nominal + delta;
    if (candidate < 0 || candidate + HOP > mono.length) continue;
    let score = 0;
    for (let i = 0; i < HOP; i += STEP) score += mono[natural + i] * mono[candidate + i];
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Changes the tempo without changing the pitch (WSOLA: overlapping frames
 * read faster or slower than they are written). `rate` > 1 speeds up.
 * Same result as `preservesPitch` on an <audio> element, which the
 * offline rendering cannot use.
 */
export function timeStretch(channels: Float32Array[], rate: number): Float32Array[] {
  if (!channels.length || rate === 1) return channels.map((channel) => channel.slice());
  const inputLength = channels[0].length;
  const outputLength = Math.floor(inputLength / rate);
  const output = channels.map(() => new Float32Array(outputLength + FRAME));
  const weights = new Float32Array(outputLength + FRAME);
  const window = hann(FRAME);
  const mono = toMono(channels);

  let previous = 0;
  for (let at = 0; at < outputLength; at += HOP) {
    const nominal = Math.round(at * rate);
    const position = at === 0 ? 0 : bestPosition(mono, previous + HOP, nominal);
    const size = Math.min(FRAME, inputLength - position);
    for (let c = 0; c < channels.length; c++) {
      const input = channels[c];
      const out = output[c];
      for (let i = 0; i < size; i++) out[at + i] += input[position + i] * window[i];
    }
    for (let i = 0; i < size; i++) weights[at + i] += window[i];
    previous = position;
  }

  // The edges are not covered by two windows: their weight is restored.
  for (const out of output) for (let i = 0; i < outputLength; i++) if (weights[i] > 1e-3) out[i] /= weights[i];
  return output.map((out) => out.slice(0, outputLength));
}

/**
 * Mixes the vocals over the beat as the preview plays them:
 * beatTime = beatStart + vocalsTime × beatSpeed. The result lasts as long as
 * the vocals, is stereo, and is scaled down if it would clip.
 */
export function mixRemix(
  vocals: Float32Array[],
  beat: Float32Array[],
  sampleRate: number,
  settings: RemixSettings,
): [Float32Array, Float32Array] {
  const length = vocals[0].length;
  const start = Math.round(settings.beatStart * sampleRate);
  // Only the part of the beat heard under the vocals is stretched.
  const needed = Math.ceil(length * settings.beatSpeed) + FRAME;
  const stretched = timeStretch(
    beat.map((channel) => channel.subarray(start, start + needed)),
    settings.beatSpeed,
  );

  const mix = [0, 1].map((c) => {
    const voice = vocals[Math.min(c, vocals.length - 1)];
    const prod = stretched[Math.min(c, stretched.length - 1)] ?? new Float32Array(0);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = voice[i] * settings.vocalsVolume + (i < prod.length ? prod[i] * settings.beatVolume : 0);
    }
    return out;
  }) as [Float32Array, Float32Array];

  let peak = 0;
  for (const channel of mix) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  if (peak > 1) for (const channel of mix) for (let i = 0; i < length; i++) channel[i] *= 0.98 / peak;
  return mix;
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
  return out;
}

/** Samples encoded between two pauses that let the page repaint. */
const ENCODE_BLOCK = 1152 * 32;

/**
 * Encodes stereo samples to MP3 (LAME compiled to JavaScript). 192 kbps
 * keeps a 4-minute remix around 6 MB, under the 25 MB upload limit.
 */
export async function encodeMp3([left, right]: [Float32Array, Float32Array], sampleRate: number, kbps = 192): Promise<Blob> {
  const encoder = new Mp3Encoder(2, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += ENCODE_BLOCK) {
    parts.push(encoder.encodeBuffer(toInt16(left.subarray(i, i + ENCODE_BLOCK)), toInt16(right.subarray(i, i + ENCODE_BLOCK))));
    await new Promise((resolve) => setTimeout(resolve));
  }
  parts.push(encoder.flush());
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

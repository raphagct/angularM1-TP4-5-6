/** Formats seconds as m:ss, or h:mm:ss for long tracks. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Reduces decoded PCM samples to `count` peaks between 0 and 1.
 * Each peak is the loudest absolute sample of its slice, across all channels;
 * the result is normalized so that the loudest peak equals 1.
 */
export function computePeaks(channels: Float32Array[], count: number): number[] {
  const length = channels[0]?.length ?? 0;
  if (count <= 0 || length === 0) return [];

  const peaks = new Array<number>(count).fill(0);
  const sliceSize = length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * sliceSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * sliceSize));
    let max = 0;
    for (const channel of channels) {
      for (let j = start; j < end && j < length; j++) {
        const value = Math.abs(channel[j]);
        if (value > max) max = value;
      }
    }
    peaks[i] = max;
  }
  return normalizePeaks(peaks);
}

/** Scales peaks so that the highest one equals 1 (silence stays at 0). */
export function normalizePeaks(peaks: number[]): number[] {
  const max = Math.max(0, ...peaks);
  return max > 0 ? peaks.map((peak) => peak / max) : peaks.map(() => 0);
}

/** Resamples peaks to exactly `count` bars, keeping the max of each bucket. */
export function resamplePeaks(peaks: number[], count: number): number[] {
  if (count <= 0 || peaks.length === 0) return [];
  const bucket = peaks.length / count;
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) max = Math.max(max, peaks[j]);
    return max;
  });
}

/** Converts a pointer X coordinate into a 0..1 position inside an element. */
export function fractionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

export interface WaveformColors {
  played: string;
  hover: string;
  idle: string;
}

export interface WaveformDrawOptions {
  width: number;
  height: number;
  /** Playback position from 0 to 1. */
  progress: number;
  /** Hovered position from 0 to 1, or null. */
  hover: number | null;
  barWidth: number;
  gap: number;
  colors: WaveformColors;
}

/** Minimal subset of CanvasRenderingContext2D used to draw, easy to fake in tests. */
export type WaveformContext = Pick<
  CanvasRenderingContext2D,
  'clearRect' | 'fillRect' | 'fillStyle' | 'globalAlpha'
>;

/**
 * Draws SoundCloud-style bars: a main bar above a baseline at 70% of the
 * height and a dimmer reflection below. Bars before the playback position use
 * the played color, bars before the hovered position use the hover color.
 * Returns the colour of each bar, which makes the rendering easy to test.
 */
export function drawWaveform(ctx: WaveformContext, peaks: number[], options: WaveformDrawOptions): string[] {
  const { width, height, progress, hover, barWidth, gap, colors } = options;
  ctx.clearRect(0, 0, width, height);
  const step = barWidth + gap;
  const count = Math.floor((width + gap) / step);
  const bars = resamplePeaks(peaks, count);
  const baseline = Math.round(height * 0.7);
  const playedX = progress * width;
  const hoverX = hover == null ? -1 : hover * width;

  return bars.map((peak, i) => {
    const x = i * step;
    const center = x + barWidth / 2;
    const color = center <= playedX ? colors.played : center <= hoverX ? colors.hover : colors.idle;
    const top = Math.max(1, peak * baseline);
    const reflection = Math.max(1, peak * (height - baseline - 1));

    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    ctx.fillRect(x, baseline - top, barWidth, top);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x, baseline + 1, barWidth, reflection);
    ctx.globalAlpha = 1;
    return color;
  });
}

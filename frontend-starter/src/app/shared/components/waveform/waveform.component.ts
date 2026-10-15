import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { drawWaveform, formatDuration, fractionFromPointer, WaveformColors } from '@/shared/utils/audio';

const COLORS: WaveformColors = {
  played: 'oklch(0.75 0.2 145)',
  hover: 'oklch(0.75 0.2 145 / 0.5)',
  idle: 'oklch(1 0 0 / 0.32)',
};

/**
 * SoundCloud-like waveform drawn on a canvas. The bars before the playback
 * position turn green; hovering previews a position and clicking seeks.
 * The component only draws: the page owns the <audio> element.
 */
@Component({
  selector: 'app-waveform',
  template: `
    <canvas
      #canvas
      [style.height.px]="height()"
      (pointermove)="onPointerMove($event)"
      (pointerleave)="hover.set(null)"
      (click)="onClick($event)"
    ></canvas>
    @if (hover() !== null && duration() > 0) {
      <span class="tooltip" [style.left.%]="hover()! * 100">{{ hoverLabel() }}</span>
    }
  `,
  styles: `
    :host { position: relative; display: block; outline: none; border-radius: 6px; }
    :host(:focus-visible) { box-shadow: 0 0 0 2px oklch(0.75 0.2 145 / 60%); }
    canvas { display: block; width: 100%; cursor: pointer; touch-action: none; }
    .tooltip {
      position: absolute;
      top: -1.6rem;
      transform: translateX(-50%);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
      background: oklch(0.75 0.2 145);
      color: oklch(0.07 0 0);
      font-size: 0.7rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      pointer-events: none;
    }
  `,
  host: {
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Position de lecture',
    'aria-valuemin': '0',
    '[attr.aria-valuemax]': 'duration()',
    '[attr.aria-valuenow]': 'currentSeconds()',
    '[attr.aria-valuetext]': 'currentLabel()',
    '(keydown.arrowright)': 'nudge(0.05, $event)',
    '(keydown.arrowleft)': 'nudge(-0.05, $event)',
  },
})
export class WaveformComponent {
  /** Normalized peaks (0..1), at any resolution. */
  readonly peaks = input<number[]>([]);
  /** Playback position from 0 to 1. */
  readonly progress = input(0);
  /** Track duration in seconds, used for the tooltip and aria values. */
  readonly duration = input(0);
  readonly height = input(96);
  readonly barWidth = input(3);
  readonly gap = input(1);

  /** Emits the requested position from 0 to 1. */
  readonly seek = output<number>();

  readonly hover = signal<number | null>(null);
  /** Rendered width in CSS pixels, updated by a ResizeObserver. */
  readonly width = signal(0);
  /** Colour of each drawn bar, exposed for tests and debugging. */
  readonly bars = signal<string[]>([]);

  readonly currentSeconds = computed(() => Math.round(this.progress() * this.duration()));
  readonly currentLabel = computed(() => formatDuration(this.progress() * this.duration()));
  readonly hoverLabel = computed(() => formatDuration((this.hover() ?? 0) * this.duration()));

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const destroyRef = inject(DestroyRef);

    afterNextRender(() => {
      const element = this.canvas().nativeElement;
      this.width.set(element.clientWidth);
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => this.width.set(entry.contentRect.width));
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });

    effect(() => this.draw());
  }

  onPointerMove(event: PointerEvent): void {
    this.hover.set(this.fraction(event));
  }

  onClick(event: MouseEvent): void {
    this.seek.emit(this.fraction(event));
  }

  nudge(delta: number, event: Event): void {
    event.preventDefault();
    this.seek.emit(Math.min(1, Math.max(0, this.progress() + delta)));
  }

  private fraction(event: MouseEvent): number {
    return fractionFromPointer(event.clientX, this.canvas().nativeElement.getBoundingClientRect());
  }

  /** Redraws whenever peaks, progress, hover or size change. */
  private draw(): void {
    const element = this.canvas().nativeElement;
    const width = this.width();
    const height = this.height();
    const peaks = this.peaks();
    const progress = this.progress();
    const hover = this.hover();
    if (!width) return;

    // The backing store is scaled by devicePixelRatio for a sharp result on HiDPI screens.
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (element.width !== pixelWidth) element.width = pixelWidth;
    if (element.height !== pixelHeight) element.height = pixelHeight;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    this.bars.set(
      drawWaveform(ctx, peaks, {
        width,
        height,
        progress,
        hover,
        barWidth: this.barWidth(),
        gap: this.gap(),
        colors: COLORS,
      }),
    );
  }
}

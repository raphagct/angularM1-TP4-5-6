import { Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideArrowLeft,
  lucidePause,
  lucidePlay,
  lucideRotateCcw,
  lucideRotateCw,
  lucideVolume2,
  lucideVolumeX,
} from '@ng-icons/lucide';
import { Subscription } from 'rxjs';
import { ZardButtonComponent } from '@/shared/components/button';
import { TrackCoverComponent } from '@/shared/components/track-cover';
import { WaveformComponent } from '@/shared/components/waveform';
import { DurationPipe } from '@/shared/pipes/duration.pipe';
import { Track } from '@/shared/models/track.model';
import { TrackService } from '@/shared/services/track.service';
import { AudioAnalysisService } from '@/shared/services/audio-analysis.service';

/** Flat line used as a seek bar when the browser cannot decode the waveform. */
const FALLBACK_PEAKS = new Array<number>(200).fill(0.06);

@Component({
  imports: [
    DatePipe,
    DecimalPipe,
    RouterLink,
    NgIcon,
    ZardButtonComponent,
    TrackCoverComponent,
    WaveformComponent,
    DurationPipe,
  ],
  templateUrl: './track-player-page.html',
  styleUrl: './track-player-page.css',
  viewProviders: [
    provideIcons({
      lucideArrowLeft,
      lucidePause,
      lucidePlay,
      lucideRotateCcw,
      lucideRotateCw,
      lucideVolume2,
      lucideVolumeX,
    }),
  ],
  host: { '(document:keydown.space)': 'onSpace($event)' },
})
export class TrackPlayerPageComponent {
  private readonly service = inject(TrackService);
  private readonly analysis = inject(AudioAnalysisService);
  private readonly route = inject(ActivatedRoute);

  readonly track = signal<Track | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly audioUrl = signal<string | null>(null);
  readonly peaks = signal<number[]>([]);
  readonly analysing = signal(false);
  readonly waveformError = signal(false);

  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly volume = signal(1);
  readonly muted = signal(false);
  private readonly mediaDuration = signal(0);

  /** The real media duration wins; the API metadata is used until it is known. */
  readonly duration = computed(() => this.mediaDuration() || this.track()?.duration || 0);
  readonly progress = computed(() => {
    const duration = this.duration();
    return duration > 0 ? Math.min(1, this.currentTime() / duration) : 0;
  });
  /** e.g. "320 kbps · 44.1 kHz", or an empty string when unknown. */
  readonly quality = computed(() => {
    const track = this.track();
    const parts: string[] = [];
    if (track?.bitrate) parts.push(`${Math.round(track.bitrate / 1000)} kbps`);
    if (track?.sampleRate) parts.push(`${+(track.sampleRate / 1000).toFixed(1)} kHz`);
    return parts.join(' · ');
  });
  readonly waveformPeaks = computed(() => (this.waveformError() ? FALLBACK_PEAKS : this.peaks()));

  private readonly audio = viewChild<ElementRef<HTMLAudioElement>>('audio');
  private frame = 0;
  private requests = new Subscription();
  /** Incremented on each load so a late waveform result from a previous track is ignored. */
  private loadId = 0;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('id');
      if (id) this.load(id);
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopLoop();
      this.requests.unsubscribe();
      this.setAudioUrl(null);
    });
  }

  load(id: string): void {
    this.requests.unsubscribe();
    this.requests = new Subscription();
    this.stopLoop();
    this.setAudioUrl(null);
    const loadId = ++this.loadId;
    this.track.set(null);
    this.peaks.set([]);
    this.waveformError.set(false);
    this.playing.set(false);
    this.currentTime.set(0);
    this.mediaDuration.set(0);
    this.error.set(null);
    this.loading.set(true);

    this.requests.add(
      this.service.get(id).subscribe({
        next: (track) => {
          console.debug('[TrackPlayer] Piste chargée', track.id);
          this.track.set(track);
          this.loading.set(false);
        },
        error: (error: HttpErrorResponse) => {
          console.error('[TrackPlayer] Chargement impossible', error.status);
          this.error.set(error.status === 404 ? 'Piste introuvable.' : 'Impossible de charger la piste.');
          this.loading.set(false);
        },
      }),
    );

    this.requests.add(
      this.service.audio(id).subscribe({
        next: (blob) => {
          console.debug('[TrackPlayer] Audio chargé', id);
          this.setAudioUrl(URL.createObjectURL(blob));
          void this.analyse(blob, loadId);
        },
        error: (error: HttpErrorResponse) => {
          console.error('[TrackPlayer] Audio indisponible', error.status);
          // A metadata error (e.g. 404) is more precise: it is kept.
          if (!this.error()) this.error.set('Impossible de lire la piste.');
        },
      }),
    );
  }

  /** Decodes the audio to compute the waveform peaks. */
  async analyse(blob: Blob, loadId = this.loadId): Promise<void> {
    this.analysing.set(true);
    try {
      const peaks = await this.analysis.peaks(blob);
      if (loadId === this.loadId) this.peaks.set(peaks);
    } catch (error) {
      console.error('[TrackPlayer] Décodage de la forme d’onde impossible', error);
      if (loadId === this.loadId) this.waveformError.set(true);
    } finally {
      if (loadId === this.loadId) this.analysing.set(false);
    }
  }

  toggle(): void {
    const element = this.audio()?.nativeElement;
    if (!element) return;
    if (element.paused) {
      element.play().catch((error: unknown) => console.error('[TrackPlayer] Lecture refusée', error));
    } else {
      element.pause();
    }
  }

  /** Moves the playback to a position between 0 and 1. */
  seek(fraction: number): void {
    this.seekTo(fraction * this.duration());
  }

  skip(seconds: number): void {
    this.seekTo(this.currentTime() + seconds);
  }

  /** Moves the playback to a time in seconds, clamped to the track duration. */
  private seekTo(seconds: number): void {
    const element = this.audio()?.nativeElement;
    const duration = this.duration();
    if (!element || !duration) return;
    const time = Math.min(duration, Math.max(0, seconds));
    element.currentTime = time;
    this.currentTime.set(time);
  }

  setVolume(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.volume.set(value);
    this.muted.set(value === 0);
    const element = this.audio()?.nativeElement;
    if (element) {
      element.volume = value;
      element.muted = value === 0;
    }
  }

  toggleMute(): void {
    const muted = !this.muted();
    this.muted.set(muted);
    const element = this.audio()?.nativeElement;
    if (element) element.muted = muted;
  }

  onLoadedMetadata(): void {
    const duration = this.audio()?.nativeElement.duration ?? 0;
    if (Number.isFinite(duration)) this.mediaDuration.set(duration);
  }

  onPlay(): void {
    this.playing.set(true);
    this.startLoop();
  }

  onPause(): void {
    this.playing.set(false);
    this.stopLoop();
    this.syncTime();
  }

  onEnded(): void {
    this.playing.set(false);
    this.stopLoop();
    this.currentTime.set(this.duration());
  }

  /** timeupdate only fires ~4 times per second: it is the fallback for the animation loop. */
  syncTime(): void {
    const element = this.audio()?.nativeElement;
    if (element) this.currentTime.set(element.currentTime);
  }

  /** Space toggles playback, except when a form control or button has the focus. */
  onSpace(event: Event): void {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, button, a')) return;
    event.preventDefault();
    this.toggle();
  }

  /** requestAnimationFrame keeps the green progress smooth (~60 fps). */
  private startLoop(): void {
    this.stopLoop();
    if (typeof requestAnimationFrame === 'undefined') return;
    const tick = () => {
      this.syncTime();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private setAudioUrl(url: string | null): void {
    const previous = this.audioUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.audioUrl.set(url);
  }
}

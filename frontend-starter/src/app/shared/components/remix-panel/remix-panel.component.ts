import { Component, computed, DestroyRef, ElementRef, inject, input, OnInit, output, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse, HttpEventType, HttpResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideLibrary,
  lucideMic,
  lucidePause,
  lucidePlay,
  lucideTrash2,
  lucideWandSparkles,
} from '@ng-icons/lucide';
import { filter, interval, lastValueFrom, Subscription, switchMap, takeWhile } from 'rxjs';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardSonnerService } from '@/shared/components/sonner';
import { DurationPipe } from '@/shared/pipes/duration.pipe';
import { Track, VocalsStatus } from '@/shared/models/track.model';
import { TrackService } from '@/shared/services/track.service';
import { RemixRenderService } from '@/shared/services/remix-render.service';

/** Delay between two status checks while Demucs is running. */
export const POLL_INTERVAL = 5000;

/** Above this gap (in seconds) between the vocals and the beat, the beat is moved back in sync. */
const MAX_DRIFT = 0.15;

/**
 * Extracts the vocals of a track (Demucs, on the API) then plays them over
 * another track of the library used as the beat ("prod").
 * The beat position follows the vocals: beatTime = beatStart + vocalsTime × beatSpeed.
 */
@Component({
  selector: 'app-remix-panel',
  imports: [DecimalPipe, RouterLink, NgIcon, ZardButtonComponent, DurationPipe],
  templateUrl: './remix-panel.component.html',
  styleUrl: './remix-panel.component.css',
  viewProviders: [
    provideIcons({ lucideDownload, lucideLibrary, lucideMic, lucidePause, lucidePlay, lucideTrash2, lucideWandSparkles }),
  ],
})
export class RemixPanelComponent implements OnInit {
  private readonly service = inject(TrackService);
  private readonly renderer = inject(RemixRenderService);
  private readonly sonner = inject(ZardSonnerService);

  readonly track = input.required<Track>();
  /** Emitted when the remix starts, so the page can pause its own player. */
  readonly started = output<void>();

  readonly status = signal<VocalsStatus>('none');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly vocalsUrl = signal<string | null>(null);
  readonly beats = signal<Track[]>([]);
  readonly beatId = signal<string | null>(null);
  readonly beatUrl = signal<string | null>(null);

  readonly playing = signal(false);
  readonly currentTime = signal(0);
  readonly duration = signal(0);
  readonly vocalsVolume = signal(1);
  readonly beatVolume = signal(0.8);
  /** Tempo of the beat, to match the vocals; the pitch is kept. */
  readonly beatSpeed = signal(1);
  /** Position in the beat (seconds) where the vocals start, to skip an intro. */
  readonly beatStart = signal(0);

  /** Title of the remix saved to the library; empty means the default title. */
  readonly remixTitle = signal('');
  readonly saving = signal<'rendering' | 'uploading' | null>(null);
  /** The last remix added to the library, to link to it. */
  readonly saved = signal<Track | null>(null);

  readonly ready = computed(() => !!this.vocalsUrl() && !!this.beatUrl());
  readonly downloadName = computed(() => `${this.track().title} (voix).mp3`);
  readonly defaultTitle = computed(() => {
    const beat = this.beats().find((track) => track.id === this.beatId());
    return `${this.track().title} (remix${beat ? ' sur ' + beat.title : ''})`;
  });

  /** The blobs are kept to render the remix; the <audio> elements only get their URLs. */
  private vocalsBlob: Blob | null = null;
  private beatBlob: Blob | null = null;

  private readonly vocalsAudio = viewChild<ElementRef<HTMLAudioElement>>('vocals');
  private readonly beatAudio = viewChild<ElementRef<HTMLAudioElement>>('beat');
  private poll = new Subscription();
  private beatRequest = new Subscription();
  private readonly requests = new Subscription();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.poll.unsubscribe();
      this.beatRequest.unsubscribe();
      this.requests.unsubscribe();
      this.setUrl(this.vocalsUrl, null);
      this.setUrl(this.beatUrl, null);
    });
  }

  ngOnInit(): void {
    this.applyStatus(this.track().vocalsStatus ?? 'none');
  }

  /** Asks the API to extract the vocals, then waits for the result. */
  extract(): void {
    this.error.set(null);
    this.busy.set(true);
    this.requests.add(
      this.service.extractVocals(this.track().id).subscribe({
        next: (track) => {
          console.debug('[Remix] Séparation lancée', track.id);
          this.busy.set(false);
          this.applyStatus(track.vocalsStatus ?? 'processing');
        },
        error: (error: HttpErrorResponse) => {
          console.error('[Remix] Séparation refusée', error.status);
          this.busy.set(false);
          this.error.set(error.error?.message ?? 'Impossible de lancer la séparation.');
        },
      }),
    );
  }

  /** Deletes the extracted vocals to free storage. */
  deleteVocals(): void {
    this.pause();
    this.busy.set(true);
    this.requests.add(
      this.service.deleteVocals(this.track().id).subscribe({
        next: () => {
          this.busy.set(false);
          this.vocalsBlob = null;
          this.setUrl(this.vocalsUrl, null);
          this.applyStatus('none');
        },
        error: (error: HttpErrorResponse) => {
          console.error('[Remix] Suppression de la voix impossible', error.status);
          this.busy.set(false);
          this.error.set('Impossible de supprimer la voix.');
        },
      }),
    );
  }

  selectBeat(event: Event): void {
    const id = (event.target as HTMLSelectElement).value || null;
    this.pause();
    this.beatRequest.unsubscribe();
    this.setUrl(this.beatUrl, null);
    this.beatBlob = null;
    this.beatId.set(id);
    if (!id) return;
    this.beatRequest = this.service.audio(id).subscribe({
      next: (blob) => {
        this.beatBlob = blob;
        this.setUrl(this.beatUrl, URL.createObjectURL(blob));
      },
      error: (error: HttpErrorResponse) => {
        console.error('[Remix] Prod indisponible', error.status);
        this.error.set('Impossible de charger la prod.');
      },
    });
  }

  toggle(): void {
    if (this.playing()) {
      this.pause();
      return;
    }
    const vocals = this.vocalsAudio()?.nativeElement;
    const beat = this.beatAudio()?.nativeElement;
    if (!vocals || !beat) return;
    this.started.emit();
    this.sync(true);
    Promise.all([vocals.play(), beat.play()])
      .then(() => this.playing.set(true))
      .catch((error: unknown) => {
        console.error('[Remix] Lecture refusée', error);
        this.pause();
      });
  }

  pause(): void {
    this.vocalsAudio()?.nativeElement.pause();
    this.beatAudio()?.nativeElement.pause();
    this.playing.set(false);
  }

  seek(event: Event): void {
    const vocals = this.vocalsAudio()?.nativeElement;
    if (!vocals) return;
    vocals.currentTime = Number((event.target as HTMLInputElement).value);
    this.currentTime.set(vocals.currentTime);
    this.sync(true);
  }

  setVocalsVolume(event: Event): void {
    this.vocalsVolume.set(Number((event.target as HTMLInputElement).value));
    const vocals = this.vocalsAudio()?.nativeElement;
    if (vocals) vocals.volume = this.vocalsVolume();
  }

  setBeatVolume(event: Event): void {
    this.beatVolume.set(Number((event.target as HTMLInputElement).value));
    const beat = this.beatAudio()?.nativeElement;
    if (beat) beat.volume = this.beatVolume();
  }

  setBeatSpeed(event: Event): void {
    this.beatSpeed.set(Number((event.target as HTMLInputElement).value));
    this.sync(true);
  }

  setBeatStart(event: Event): void {
    this.beatStart.set(Number((event.target as HTMLInputElement).value));
    this.sync(true);
  }

  onVocalsMetadata(): void {
    const duration = this.vocalsAudio()?.nativeElement.duration ?? 0;
    if (Number.isFinite(duration)) this.duration.set(duration);
    const vocals = this.vocalsAudio()?.nativeElement;
    if (vocals) vocals.volume = this.vocalsVolume();
  }

  onBeatMetadata(): void {
    const beat = this.beatAudio()?.nativeElement;
    if (beat) beat.volume = this.beatVolume();
    this.sync(true);
  }

  /** timeupdate of the vocals: updates the position and corrects the beat drift. */
  onTimeUpdate(): void {
    const vocals = this.vocalsAudio()?.nativeElement;
    if (!vocals) return;
    this.currentTime.set(vocals.currentTime);
    this.sync(false);
  }

  onEnded(): void {
    this.pause();
  }

  setRemixTitle(event: Event): void {
    this.remixTitle.set((event.target as HTMLInputElement).value);
  }

  /**
   * Renders the remix with the current settings to an MP3, then uploads it
   * like any other track: it appears in the library and can be remixed again.
   */
  async save(): Promise<void> {
    if (!this.vocalsBlob || !this.beatBlob || this.saving()) return;
    this.pause();
    this.error.set(null);
    this.saved.set(null);
    const title = this.remixTitle().trim() || this.defaultTitle();
    try {
      this.saving.set('rendering');
      const mp3 = await this.renderer.render(this.vocalsBlob, this.beatBlob, {
        vocalsVolume: this.vocalsVolume(),
        beatVolume: this.beatVolume(),
        beatSpeed: this.beatSpeed(),
        beatStart: this.beatStart(),
      });

      this.saving.set('uploading');
      const file = new File([mp3], `${title}.mp3`, { type: 'audio/mpeg' });
      const response = await lastValueFrom(
        this.service
          .upload(file, { title, artist: this.track().artist })
          .pipe(filter((event): event is HttpResponse<Track> => event.type === HttpEventType.Response)),
      );
      const track = response.body!;
      console.debug('[Remix] Remix ajouté à la bibliothèque', track.id);
      this.saved.set(track);
      this.sonner.success('Remix ajouté à ta bibliothèque', { description: track.title });
    } catch (error) {
      console.error('[Remix] Enregistrement du remix impossible', error);
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ?? 'Impossible d’envoyer le remix.')
          : 'Impossible de créer le remix dans le navigateur.',
      );
    } finally {
      this.saving.set(null);
    }
  }

  /** Moves the beat to the position matching the vocals (always when `force`, otherwise only if it drifted). */
  private sync(force: boolean): void {
    const vocals = this.vocalsAudio()?.nativeElement;
    const beat = this.beatAudio()?.nativeElement;
    if (!vocals || !beat) return;
    beat.preservesPitch = true;
    beat.playbackRate = this.beatSpeed();
    const target = this.beatStart() + vocals.currentTime * this.beatSpeed();
    if (force || Math.abs(beat.currentTime - target) > MAX_DRIFT) beat.currentTime = target;
  }

  private applyStatus(status: VocalsStatus): void {
    this.status.set(status);
    this.poll.unsubscribe();
    if (status === 'processing') this.waitForVocals();
    if (status === 'ready') this.loadVocals();
  }

  /** Checks the track every few seconds until Demucs has finished. */
  private waitForVocals(): void {
    const id = this.track().id;
    this.poll = interval(POLL_INTERVAL)
      .pipe(
        switchMap(() => this.service.get(id)),
        takeWhile((track) => track.vocalsStatus === 'processing', true),
      )
      .subscribe({
        next: (track) => {
          const status = track.vocalsStatus ?? 'none';
          if (status === 'processing') return;
          console.debug('[Remix] Séparation terminée', status);
          if (status === 'failed') this.error.set('La séparation a échoué. Consulte les logs du backend.');
          this.applyStatus(status);
        },
        error: (error: HttpErrorResponse) => {
          console.error('[Remix] Suivi de la séparation impossible', error.status);
          this.error.set('Impossible de suivre la séparation.');
        },
      });
  }

  private loadVocals(): void {
    const id = this.track().id;
    this.requests.add(
      this.service.vocals(id).subscribe({
        next: (blob) => {
          this.vocalsBlob = blob;
          this.setUrl(this.vocalsUrl, URL.createObjectURL(blob));
        },
        error: (error: HttpErrorResponse) => {
          console.error('[Remix] Voix indisponible', error.status);
          this.error.set('Impossible de charger la voix.');
        },
      }),
    );
    // The beat is chosen among the other tracks of the library (first 20).
    this.requests.add(
      this.service.list(1, 20).subscribe({
        next: (page) => this.beats.set(page.items.filter((track) => track.id !== id)),
        error: (error: HttpErrorResponse) => console.error('[Remix] Liste des prods indisponible', error.status),
      }),
    );
  }

  /** Replaces a blob URL and releases the previous one. */
  private setUrl(target: typeof this.vocalsUrl, url: string | null): void {
    const previous = target();
    if (previous) URL.revokeObjectURL(previous);
    target.set(url);
  }
}

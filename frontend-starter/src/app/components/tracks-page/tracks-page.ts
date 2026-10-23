import { Component, inject, signal, DestroyRef } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpEventType, HttpErrorResponse } from '@angular/common/http';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';
import { TrackTagsService } from '../../shared/services/track-tags.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardCardImports } from '@/shared/components/card/card.imports';
import { ZardProgressComponent } from '@/shared/components/progress';
import { ZardBadgeComponent } from '@/shared/components/badge';
import { ZardSeparatorComponent } from '@/shared/components/separator';
import { ZardDialogImports } from '@/shared/components/dialog/dialog.imports';
import { ZardSonnerService } from '@/shared/components/sonner';
import { TrackCoverComponent } from '@/shared/components/track-cover';
import { DurationPipe } from '@/shared/pipes/duration.pipe';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideUpload,
  lucidePlay,
  lucideTrash2,
  lucideRefreshCw,
  lucideMusic,
  lucideChevronLeft,
  lucideChevronRight,
  lucideFile,
  lucideFileAudio,
  lucideFolderOpen,
  lucideImageOff,
  lucidePencil,
  lucideCheck,
  lucideCircleAlert,
  lucideX,
} from '@ng-icons/lucide';

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

/** Where the details shown before upload come from. */
export type DetailsSource = 'tags' | 'filename';

/** Technical information read from the audio stream before upload. */
export interface AudioInfo {
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
}

@Component({
  imports: [
    ReactiveFormsModule,
    DatePipe,
    DecimalPipe,
    ZardButtonComponent,
    ...ZardCardImports,
    ZardProgressComponent,
    ZardBadgeComponent,
    ...ZardDialogImports,
    NgIcon,
    TrackCoverComponent,
    DurationPipe,
  ],
  templateUrl: './tracks-page.html',
  styleUrl: './tracks-page.css',
  viewProviders: [
    provideIcons({
      lucideUpload,
      lucidePlay,
      lucideTrash2,
      lucideRefreshCw,
      lucideMusic,
      lucideChevronLeft,
      lucideChevronRight,
      lucideFile,
      lucideFileAudio,
      lucideFolderOpen,
      lucideImageOff,
      lucidePencil,
      lucideCheck,
      lucideCircleAlert,
      lucideX,
    }),
  ],
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly tags = inject(TrackTagsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sonner = inject(ZardSonnerService);
  private readonly router = inject(Router);

  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = signal(5);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Details sent with the upload; filled from the file tags, editable on demand. */
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    artist: new FormControl('', { nonNullable: true }),
    album: new FormControl('', { nonNullable: true }),
  });
  readonly title = this.form.controls.title;

  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly ghostFile = signal<File | null>(null);

  /** Preview of the cover embedded in the file; the API extracts it itself. */
  readonly coverPreview = signal<string | null>(null);

  /** True while the tags of the chosen file are being read. */
  readonly readingTags = signal(false);
  /** Whether the details come from the file tags or only from its name. */
  readonly detailsSource = signal<DetailsSource | null>(null);
  /** The details are read-only until the user asks to edit them. */
  readonly editing = signal(false);
  /** Duration, bitrate and sample rate of the chosen file. */
  readonly audioInfo = signal<AudioInfo | null>(null);

  readonly deleting = signal<Set<string>>(new Set());

  /** Delete confirmation dialog state */
  readonly deleteDialogVisible = signal(false);
  readonly trackToDelete = signal<Track | null>(null);

  /** Drag-and-drop state */
  readonly isDragging = signal(false);

  /** Audio file chosen by click or drag-and-drop. */
  readonly file = signal<File | undefined>(undefined);

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.setCoverPreview(null));
  }

  choose(event: Event): void {
    if (this.uploading()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Resetting the value lets the user pick the same file again.
    input.value = '';
    if (file) this.selectAudio(file);
  }

  /**
   * Validates an audio file chosen by click or drag-and-drop. A rejected file
   * keeps the previously chosen one, so a wrong drop does not lose any work.
   */
  selectAudio(file: File): void {
    this.uploadProgress.set(0);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    if (!file.type.startsWith('audio/')) {
      this.uploadError.set(`« ${file.name} » n'est pas un fichier audio.`);
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      this.uploadError.set('Le fichier ne doit pas dépasser 25 Mo.');
      return;
    }

    this.resetDetails();
    this.file.set(file);
    console.debug('[TracksPage] Fichier valide', file.name);
    void this.prefill(file);
  }

  /** Forgets the chosen file and its details. */
  clearFile(): void {
    if (this.uploading()) return;
    this.file.set(undefined);
    this.uploadError.set(null);
    this.resetDetails();
  }

  /** Switches the details between read-only and editable. */
  toggleEditing(): void {
    if (!this.file() || this.readingTags() || this.uploading()) return;
    this.editing.update((editing) => !editing);
  }

  /** Short format label shown next to the file name, e.g. "MP3". */
  formatOf(file: File): string {
    const extension = file.name.includes('.') ? file.name.split('.').pop() : '';
    return (extension || file.type.replace('audio/', '')).toUpperCase();
  }

  private resetDetails(): void {
    this.form.reset();
    this.editing.set(false);
    this.detailsSource.set(null);
    this.audioInfo.set(null);
    this.readingTags.set(false);
    this.setCoverPreview(null);
  }

  /**
   * Fills the details with the file tags. Without a title tag, the file name
   * (without extension) is used, so the user sees the title that will be saved.
   */
  private async prefill(file: File): Promise<void> {
    this.readingTags.set(true);
    const fileName = file.name.replace(/\.[^.]+$/, '');
    try {
      const tags = await this.tags.read(file);
      // Another file may have been chosen while the tags were being read.
      if (this.file() !== file) return;

      this.form.setValue({
        title: tags.title ?? fileName,
        artist: tags.artist ?? '',
        album: tags.album ?? '',
      });
      const found = Boolean(tags.title || tags.artist || tags.album || tags.cover);
      this.detailsSource.set(found ? 'tags' : 'filename');
      this.setCoverPreview(tags.cover);
      this.audioInfo.set({ duration: tags.duration, bitrate: tags.bitrate, sampleRate: tags.sampleRate });
    } catch (error) {
      // The upload still works: the API reads the tags again on its side.
      console.error('[TracksPage] Lecture des tags impossible', error);
      if (this.file() !== file) return;
      this.form.setValue({ title: fileName, artist: '', album: '' });
      this.detailsSource.set('filename');
    } finally {
      if (this.file() === file) this.readingTags.set(false);
    }
  }

  /** Shows a cover preview and releases the previous preview URL. */
  private setCoverPreview(cover: Blob | null): void {
    const previous = this.coverPreview();
    if (previous) URL.revokeObjectURL(previous);
    this.coverPreview.set(cover ? URL.createObjectURL(cover) : null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.uploading()) this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // dragleave also fires when the pointer moves onto a child element.
    const zone = event.currentTarget as Node | null;
    if (zone?.contains?.(event.relatedTarget as Node | null)) return;
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    if (this.uploading()) return;

    const droppedFile = event.dataTransfer?.files[0];
    if (droppedFile) this.selectAudio(droppedFile);
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list(this.page(), this.limit()).subscribe({
      next: (response) => {
        console.debug('[TracksPage] Pistes chargées', response.items.length);
        const lastPage = Math.max(1, Math.ceil(response.total / this.limit()));
        if (this.page() > lastPage) {
          this.page.set(lastPage);
          this.load();
          return;
        }
        this.tracks.set(response.items);
        this.total.set(response.total);
        this.loading.set(false);
      },
      error: (error) => {
        console.error('[TracksPage] Chargement impossible');
        this.error.set('Impossible de charger les pistes.');
        this.loading.set(false);
      },
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.limit()));
  }

  go(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.page.set(page);
    this.load();
  }

  upload(): void {
    const file = this.file();
    if (!file || this.uploading()) return;

    this.uploading.set(true);
    this.editing.set(false);
    this.form.disable();
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    this.uploadProgress.set(0);
    this.ghostFile.set(file);

    this.service.upload(file, this.form.getRawValue()).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
          }
        } else if (event.type === HttpEventType.Response) {
          console.debug('[TracksPage] Piste envoyée', event.body?.id);
          this.sonner.success('Piste envoyée avec succès !');
          this.form.enable();
          this.ghostFile.set(null);
          this.uploading.set(false);
          this.clearFile();
          this.page.set(1);
          this.load();
        }
      },
      error: (error) => {
        console.error('[TracksPage] Envoi impossible');
        this.sonner.error('Erreur serveur lors de l\'envoi.');
        this.uploading.set(false);
        this.form.enable();
        this.ghostFile.set(null);
      },
    });
  }

  /** Opens the player page, which shows the cover, the details and the waveform. */
  play(track: Track): void {
    console.debug('[TracksPage] Ouverture du lecteur', track.id);
    void this.router.navigate(['/tracks', track.id]);
  }

  /** Open delete confirmation dialog */
  confirmDelete(track: Track): void {
    this.trackToDelete.set(track);
    this.deleteDialogVisible.set(true);
  }

  /** Execute deletion after confirmation */
  executeDelete(): void {
    const track = this.trackToDelete();
    if (!track) return;

    this.deleteDialogVisible.set(false);

    if (this.deleting().has(track.id)) return;

    const currentDeleting = new Set(this.deleting());
    currentDeleting.add(track.id);
    this.deleting.set(currentDeleting);

    this.service.delete(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.sonner.success('Piste supprimée avec succès');
        const updatedDeleting = new Set(this.deleting());
        updatedDeleting.delete(track.id);
        this.deleting.set(updatedDeleting);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        console.error('[TracksPage] Suppression impossible', err.status);
        let errorMessage = 'Impossible de supprimer la piste.';
        if (err.status === 404) {
          errorMessage = "La piste n'existe plus ou ne vous appartient pas.";
        } else if (err.status === 403 || err.status === 401) {
          errorMessage = 'Vous n\'êtes pas autorisé à supprimer cette piste.';
        }
        this.sonner.error(errorMessage);

        const updatedDeleting = new Set(this.deleting());
        updatedDeleting.delete(track.id);
        this.deleting.set(updatedDeleting);
        this.load(); // Le backend renvoie aussi 404 si le propriétaire ne correspond pas.
      }
    });
  }
}

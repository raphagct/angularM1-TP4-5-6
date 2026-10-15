import { Component, inject, signal, DestroyRef } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpEventType, HttpErrorResponse } from '@angular/common/http';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';
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
  lucideImagePlus,
  lucideX,
} from '@ng-icons/lucide';

const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
const MAX_COVER_SIZE = 5 * 1024 * 1024;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
      lucideImagePlus,
      lucideX,
    }),
  ],
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sonner = inject(ZardSonnerService);
  private readonly router = inject(Router);

  readonly tracks = signal<Track[]>([]);
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = signal(5);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true }),
    artist: new FormControl('', { nonNullable: true }),
    album: new FormControl('', { nonNullable: true }),
    genre: new FormControl('', { nonNullable: true }),
  });
  readonly title = this.form.controls.title;

  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly ghostFile = signal<File | null>(null);

  /** Optional cover chosen by the user, with a local preview URL. */
  readonly coverFile = signal<File | null>(null);
  readonly coverPreview = signal<string | null>(null);

  readonly deleting = signal<Set<string>>(new Set());

  /** Delete confirmation dialog state */
  readonly deleteDialogVisible = signal(false);
  readonly trackToDelete = signal<Track | null>(null);

  /** Drag-and-drop state */
  readonly isDragging = signal(false);

  file?: File;

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.setCover(null));
  }

  choose(event: Event): void {
    if (this.uploading()) return;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.selectAudio(file);
  }

  /** Validates an audio file chosen by click or drag-and-drop. */
  selectAudio(file: File): void {
    this.uploadProgress.set(0);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    if (!file.type.startsWith('audio/')) {
      this.uploadError.set('Le fichier doit être un format audio.');
      this.file = undefined;
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      this.uploadError.set('Le fichier ne doit pas dépasser 25 Mo.');
      this.file = undefined;
      return;
    }

    this.file = file;
    console.debug('[TracksPage] Fichier valide', file.name);
  }

  chooseCover(event: Event): void {
    if (this.uploading()) return;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!COVER_TYPES.includes(file.type)) {
      this.uploadError.set('La pochette doit être une image JPEG, PNG ou WebP.');
      return;
    }
    if (file.size > MAX_COVER_SIZE) {
      this.uploadError.set('La pochette ne doit pas dépasser 5 Mo.');
      return;
    }

    this.uploadError.set(null);
    this.setCover(file);
    console.debug('[TracksPage] Pochette choisie', file.name);
  }

  removeCover(): void {
    this.setCover(null);
  }

  /** Replaces the chosen cover and releases the previous preview URL. */
  private setCover(file: File | null): void {
    const previous = this.coverPreview();
    if (previous) URL.revokeObjectURL(previous);
    this.coverFile.set(file);
    this.coverPreview.set(file ? URL.createObjectURL(file) : null);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
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
    if (!this.file || this.uploading()) return;

    this.uploading.set(true);
    this.form.disable();
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    this.uploadProgress.set(0);
    this.ghostFile.set(this.file);

    this.service.upload(this.file, { ...this.form.getRawValue(), cover: this.coverFile() }).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
          }
        } else if (event.type === HttpEventType.Response) {
          console.debug('[TracksPage] Piste envoyée', event.body?.id);
          this.sonner.success('Piste envoyée avec succès !');
          this.form.reset();
          this.form.enable();
          this.file = undefined;
          this.setCover(null);
          this.ghostFile.set(null);
          this.uploading.set(false);
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

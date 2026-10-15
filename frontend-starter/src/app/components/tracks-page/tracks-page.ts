import { Component, inject, signal, DestroyRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpEventType, HttpErrorResponse } from '@angular/common/http';
import { AudioSpectrumComponent } from '../audio-spectrum/audio-spectrum';
import { Track } from '../../shared/models/track.model';
import { TrackService } from '../../shared/services/track.service';

@Component({
  imports: [ReactiveFormsModule, MatPaginatorModule, MatSnackBarModule, DatePipe, DecimalPipe, AudioSpectrumComponent],
  templateUrl: './tracks-page.html', 
  styleUrl: './tracks-page.css',
})
export class TracksPageComponent {
  private readonly service = inject(TrackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);

  readonly tracks = signal<Track[]>([]);
  readonly coverUrls = signal<Record<string, string>>({});
  readonly page = signal(1);
  readonly total = signal(0);
  readonly limit = signal(5);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly audioUrl = signal('');
  readonly title = new FormControl('', { nonNullable: true });
  
  readonly uploadError = signal<string | null>(null);
  readonly uploadSuccess = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly ghostFile = signal<File | null>(null);
  
  readonly currentTrack = signal<Track | null>(null);
  readonly playError = signal<string | null>(null);
  readonly deleting = signal<Set<string>>(new Set());

  file?: File;

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => {
      if (this.audioUrl()) URL.revokeObjectURL(this.audioUrl());
      Object.values(this.coverUrls()).forEach(url => URL.revokeObjectURL(url));
    });
  }

  choose(event: Event): void {
    if (this.uploading()) return;
    this.uploadProgress.set(0);
    this.uploadError.set(null);
    this.uploadSuccess.set(null);
    this.file = (event.target as HTMLInputElement).files?.[0];
    
    if (!this.file) return;

    if (!this.file.type.startsWith('audio/')) {
      this.uploadError.set('Le fichier doit être un format audio.');
      this.file = undefined;
      return;
    }

    if (this.file.size > 25 * 1024 * 1024) {
      this.uploadError.set('Le fichier ne doit pas dépasser 25 Mo.');
      this.file = undefined;
      return;
    }

    console.debug('[TracksPage] Fichier valide', this.file.name);
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
        Object.values(this.coverUrls()).forEach(url => URL.revokeObjectURL(url));
        this.coverUrls.set({});
        this.tracks.set(response.items);
        for (const track of response.items.filter(item => item.hasCover)) {
          this.service.cover(track.id).subscribe({
            next: blob => {
              if (!this.tracks().some(item => item.id === track.id)) return;
              this.coverUrls.update(urls => ({ ...urls, [track.id]: URL.createObjectURL(blob) }));
            },
            error: () => console.warn('[TracksPage] Pochette indisponible', track.id),
          });
        }
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

  go(page: number): void {
    this.page.set(page);
    this.load();
  }

  onPageChange(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.limit.set(event.pageSize);
    this.load();
  }

  upload(): void {
    if (!this.file || this.uploading()) return;

    this.uploading.set(true);
    this.title.disable();
    this.uploadError.set(null);
    this.uploadSuccess.set(null);

    this.uploadProgress.set(0);
    this.ghostFile.set(this.file);

    this.service.upload(this.file, this.title.value).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            this.uploadProgress.set(Math.round(100 * event.loaded / event.total));
          }
        } else if (event.type === HttpEventType.Response) {
          console.debug('[TracksPage] Piste envoyée', event.body?.id);
          this.uploadSuccess.set('Piste envoyée avec succès !');
          this.title.setValue('');
          this.file = undefined;
          this.ghostFile.set(null);
          this.uploading.set(false);
          this.title.enable();
          this.page.set(1);
          this.load();
        }
      },
      error: (error) => {
        console.error('[TracksPage] Envoi impossible');
        this.uploadError.set('Erreur serveur lors de l\'envoi.');
        this.uploading.set(false);
        this.title.enable();
        this.ghostFile.set(null);
      },
    });
  }

  durationLabel(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remaining}`;
  }

  play(track: Track): void {
    this.currentTrack.set(track);
    this.playError.set(null);

    this.service.audio(track.id).subscribe({
      next: (blob) => {
        console.debug('[TracksPage] Audio chargé', track.id);
        const previousUrl = this.audioUrl();
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        this.audioUrl.set(URL.createObjectURL(blob));
      },
      error: (error) => {
        console.error('[TracksPage] Lecture impossible');
        this.playError.set('Impossible de lire la piste.');
      }
    });
  }

  delete(track: Track): void {
    if (this.deleting().has(track.id)) return;
    if (!confirm(`Voulez-vous vraiment supprimer la piste "${track.title}" ?`)) {
      return;
    }
    
    const currentDeleting = new Set(this.deleting());
    currentDeleting.add(track.id);
    this.deleting.set(currentDeleting);

    this.service.delete(track.id).subscribe({
      next: () => {
        console.debug('[TracksPage] Piste supprimée', track.id);
        this.snackBar.open('Piste supprimée avec succès', 'Fermer', { duration: 3000 });
        const updatedDeleting = new Set(this.deleting());
        updatedDeleting.delete(track.id);
        this.deleting.set(updatedDeleting);
        this.load();
      },
      error: (err: HttpErrorResponse) => {
        console.error('[TracksPage] Suppression impossible', err.status);
        let errorMessage = 'Impossible de supprimer la piste.';
        if (err.status === 404) {
          errorMessage = 'La piste n’existe plus ou ne vous appartient pas.';
        } else if (err.status === 403 || err.status === 401) {
          errorMessage = 'Vous n\'êtes pas autorisé à supprimer cette piste.';
        }
        this.snackBar.open(errorMessage, 'Fermer', { duration: 3000 });
        
        const updatedDeleting = new Set(this.deleting());
        updatedDeleting.delete(track.id);
        this.deleting.set(updatedDeleting);
        this.load(); // Le backend renvoie aussi 404 si le propriétaire ne correspond pas.
      }
    });
  }
}

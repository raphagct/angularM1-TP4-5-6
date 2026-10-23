import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { ZardSonnerService } from '@/shared/components/sonner';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TracksPageComponent } from './tracks-page';
import { TrackTags, TrackTagsService } from '@/shared/services/track-tags.service';

// Le véritable service est conservé ; seul le transport HTTP est simulé.
describe('TracksPageComponent', () => {
  let component: TracksPageComponent;
  let http: HttpTestingController;
  const sonner = { success: vi.fn(), error: vi.fn() };
  // Les tags sont lus par music-metadata dans le vrai service : ils sont simulés ici.
  const tags = { read: vi.fn<(file: Blob) => Promise<TrackTags>>() };
  const track = { id: '1', title: 'Test', originalName: 'test.mp3', mimeType: 'audio/mpeg', size: 100, createdAt: '2026-01-01' };
  const page = { items: [track], total: 1, page: 1, limit: 5, pages: 1 };

  const createObjectURL = vi.fn(() => 'blob:preview');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    sonner.success.mockClear();
    sonner.error.mockClear();
    tags.read.mockReset().mockResolvedValue({ cover: null });
    TestBed.configureTestingModule({
      imports: [TracksPageComponent],
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting(), provideRouter([]), { provide: ZardSonnerService, useValue: sonner }, { provide: TrackTagsService, useValue: tags }],
    });
    TestBed.overrideProvider(ZardSonnerService, { useValue: sonner });
    component = TestBed.createComponent(TracksPageComponent).componentInstance;
    http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/tracks?page=1&limit=5').flush(page);
  });

  afterEach(() => { http.verify(); vi.restoreAllMocks(); });

  it('supprime après confirmation, bloque un double appel et recharge la liste', () => {
    // La confirmation est maintenant gérée par le dialog, on simule l'action :
    component.confirmDelete(track);
    component.executeDelete();
    component.executeDelete();
    const req = http.expectOne('/api/tracks/1');
    expect(req.request.method).toBe('DELETE');
    expect(component.deleting().has('1')).toBe(true);
    req.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, items: [], total: 0 });
    expect(component.tracks()).toEqual([]);
    expect(component.deleting().size).toBe(0);
    expect(sonner.success).toHaveBeenCalledWith('Piste supprimée avec succès');
  });

  it('revient à la dernière page disponible lorsque la page courante devient vide', () => {
    component.page.set(2);
    component.load();
    http.expectOne('/api/tracks?page=2&limit=5').flush({ ...page, items: [], total: 5 });
    expect(component.page()).toBe(1);
    http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, total: 5 });
    expect(component.tracks()).toEqual([track]);
  });

  it('ne supprime pas si la confirmation est annulée', () => {
    // Si on ouvre le dialogue mais qu'on annule (ici on ne fait pas executeDelete)
    component.confirmDelete(track);
    // component.executeDelete(); n'est pas appelé
    http.expectNone('/api/tracks/1');
    expect(component.deleting().size).toBe(0);
  });

  it.each([404, 403, 401])('affiche un SnackBar et libère la suppression après une erreur %s', status => {
    component.confirmDelete(track);
    component.executeDelete();
    http.expectOne('/api/tracks/1').flush({}, { status, statusText: 'Erreur' });
    http.expectOne('/api/tracks?page=1&limit=5').flush(page);
    expect(component.deleting().size).toBe(0);
    expect(sonner.error).toHaveBeenCalledWith(status === 404 ? "La piste n'existe plus ou ne vous appartient pas." : "Vous n'êtes pas autorisé à supprimer cette piste.");
  });

  it('affiche la progression intermédiaire et attend la réponse pour annoncer la réussite', () => {
    component.file.set(new File(['audio'], 'test.mp3', { type: 'audio/mpeg' }));
    component.title.setValue('Mon titre');
    component.upload();
    component.upload();
    const req = http.expectOne('/api/tracks');
    expect(req.request.method).toBe('POST');
    expect(req.request.reportProgress).toBe(true);
    expect(req.request.body.get('title')).toBe('Mon titre');
    expect(req.request.body.get('audio').name).toBe('test.mp3');
    expect(component.title.disabled).toBe(true);
    req.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 100 });
    expect(component.uploadProgress()).toBe(50);
    expect(component.uploading()).toBe(true);
    expect(component.uploadSuccess()).toBeNull();
    req.flush(track, { status: 201, statusText: 'Created' });
    http.expectOne('/api/tracks?page=1&limit=5').flush(page);
    expect(component.uploading()).toBe(false);
    expect(component.title.enabled).toBe(true);
    expect(sonner.success).toHaveBeenCalledWith('Piste envoyée avec succès !');
    expect(component.file()).toBeUndefined();
    expect(component.ghostFile()).toBeNull();
  });

  it('gère un échec d’upload et permet une nouvelle tentative', () => {
    component.file.set(new File(['audio'], 'test.mp3', { type: 'audio/mpeg' }));
    component.upload();
    http.expectOne('/api/tracks').flush({}, { status: 500, statusText: 'Server Error' });
    expect(sonner.error).toHaveBeenCalledWith("Erreur serveur lors de l'envoi.");
    expect(component.uploading()).toBe(false);
    expect(component.title.enabled).toBe(true);
    expect(component.file()).toBeDefined();
    expect(component.ghostFile()).toBeNull();
  });

  it('affiche une erreur de chargement dans le template', () => {
    const fixture = TestBed.createComponent(TracksPageComponent);
    http.expectOne('/api/tracks?page=1&limit=5').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Impossible de charger les pistes.');
  });

  const audioFile = (size = 10, type = 'audio/mpeg') => {
    const file = new File(['a'], 'song.mp3', { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
  };
  const inputEvent = (file?: File) => ({ target: { files: file ? [file] : [], value: 'C:\\fake' } }) as unknown as Event;
  const dropEvent = (file?: File) =>
    ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { files: file ? [file] : [] } }) as unknown as DragEvent;

  describe('sélection du fichier audio', () => {
    it('accepte un fichier audio valide choisi au clic', () => {
      component.choose(inputEvent(audioFile()));
      expect(component.file()?.name).toBe('song.mp3');
      expect(component.uploadError()).toBeNull();
    });

    it('refuse un fichier qui n’est pas audio', () => {
      component.choose(inputEvent(audioFile(10, 'text/plain')));
      expect(component.file()).toBeUndefined();
      expect(component.uploadError()).toBe("« song.mp3 » n'est pas un fichier audio.");
    });

    it('refuse un fichier de plus de 25 Mo', () => {
      component.choose(inputEvent(audioFile(25 * 1024 * 1024 + 1)));
      expect(component.file()).toBeUndefined();
      expect(component.uploadError()).toBe('Le fichier ne doit pas dépasser 25 Mo.');
    });

    it('ignore un choix vide et un choix pendant un upload', () => {
      component.choose(inputEvent());
      expect(component.file()).toBeUndefined();
      component.uploading.set(true);
      component.choose(inputEvent(audioFile()));
      expect(component.file()).toBeUndefined();
    });

    it('gère le glisser-déposer', () => {
      component.onDragOver(dropEvent());
      expect(component.isDragging()).toBe(true);
      component.onDragLeave(dropEvent());
      expect(component.isDragging()).toBe(false);

      component.onDragOver(dropEvent());
      component.onDrop(dropEvent(audioFile()));
      expect(component.isDragging()).toBe(false);
      expect(component.file()?.name).toBe('song.mp3');
    });

    it('applique les mêmes validations au dépôt', () => {
      component.onDrop(dropEvent(audioFile(10, 'image/png')));
      expect(component.uploadError()).toBe("« song.mp3 » n'est pas un fichier audio.");
      component.uploading.set(true);
      component.onDrop(dropEvent(audioFile()));
      expect(component.file()).toBeUndefined();
    });
  });

  describe('détails lus dans les tags', () => {
    const embedded = new File(['p'], 'cover.jpg', { type: 'image/jpeg' });
    const full: TrackTags = { title: 'Song', artist: 'Band', album: 'LP', genre: 'Rock', cover: embedded };

    it('remplit les détails et l’aperçu de pochette au dépôt comme au clic', async () => {
      tags.read.mockResolvedValue(full);
      component.onDrop(dropEvent(audioFile()));
      expect(component.readingTags()).toBe(true);
      await vi.waitFor(() => expect(component.readingTags()).toBe(false));
      expect(component.form.getRawValue()).toEqual({ title: 'Song', artist: 'Band', album: 'LP' });
      expect(component.detailsSource()).toBe('tags');
      expect(createObjectURL).toHaveBeenCalledWith(embedded);
      expect(component.coverPreview()).toBe('blob:preview');

      component.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(component.form.controls.title.value).toBe('Song'));
      expect(tags.read).toHaveBeenCalledTimes(2);
    });

    it('utilise le nom du fichier sans extension quand il n’y a pas de tags', async () => {
      component.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(component.readingTags()).toBe(false));
      expect(component.form.getRawValue()).toEqual({ title: 'song', artist: '', album: '' });
      expect(component.detailsSource()).toBe('filename');
      expect(component.coverPreview()).toBeNull();
    });

    it('fait la même chose si les tags sont illisibles, sans bloquer l’upload', async () => {
      tags.read.mockRejectedValue(new Error('bad tags'));
      component.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(component.readingTags()).toBe(false));
      expect(component.file()?.name).toBe('song.mp3');
      expect(component.title.value).toBe('song');
      expect(component.detailsSource()).toBe('filename');
      expect(component.uploadError()).toBeNull();
    });

    it('repart de zéro quand on choisit un autre fichier', async () => {
      tags.read.mockResolvedValueOnce(full).mockResolvedValueOnce({ title: 'Other', cover: null });
      component.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(component.coverPreview()).toBe('blob:preview'));
      component.toggleEditing();
      component.form.controls.artist.setValue('Modifié');

      component.choose(inputEvent(audioFile()));
      expect(component.editing()).toBe(false);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
      await vi.waitFor(() => expect(component.form.controls.title.value).toBe('Other'));
      expect(component.form.controls.artist.value).toBe('');
      expect(component.coverPreview()).toBeNull();
    });

    it('garde le fichier précédent si le nouveau est refusé', async () => {
      component.choose(inputEvent(audioFile()));
      component.onDrop(dropEvent(audioFile(10, 'text/plain')));
      expect(component.file()?.name).toBe('song.mp3');
      expect(component.uploadError()).toContain("n'est pas un fichier audio");
    });

    it('les détails sont en lecture seule, modifiables via Edit une fois les tags lus', async () => {
      let resolve!: (tags: TrackTags) => void;
      tags.read.mockReturnValue(new Promise((r) => (resolve = r)));
      component.choose(inputEvent(audioFile()));
      component.toggleEditing();
      expect(component.editing()).toBe(false);

      resolve(full);
      await vi.waitFor(() => expect(component.readingTags()).toBe(false));
      component.toggleEditing();
      expect(component.editing()).toBe(true);
      component.toggleEditing();
      expect(component.editing()).toBe(false);
    });

    it('retire le fichier et ses détails', async () => {
      tags.read.mockResolvedValue(full);
      component.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(component.readingTags()).toBe(false));
      component.clearFile();
      expect(component.file()).toBeUndefined();
      expect(component.form.getRawValue()).toEqual({ title: '', artist: '', album: '' });
      expect(component.coverPreview()).toBeNull();
      expect(component.detailsSource()).toBeNull();
    });

    it('affiche les champs remplis en lecture seule et les infos du fichier avant l’upload', async () => {
      const fixture = TestBed.createComponent(TracksPageComponent);
      http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, items: [] });
      const view = fixture.componentInstance;
      const el = fixture.nativeElement as HTMLElement;
      const titleInput = () => el.querySelector('#track-title') as HTMLInputElement;
      tags.read.mockResolvedValue({ title: 'Song', cover: embedded, duration: 180, bitrate: 160000 });

      fixture.detectChanges();
      expect(titleInput().readOnly).toBe(true);
      expect(el.textContent).toContain('Browse files');
      expect(el.querySelector('.info-grid')).toBeNull();
      expect((el.querySelector('.edit-btn') as HTMLButtonElement).disabled).toBe(true);

      view.choose(inputEvent(audioFile()));
      await vi.waitFor(() => expect(view.readingTags()).toBe(false));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(titleInput().value).toBe('Song');
      expect(titleInput().readOnly).toBe(true);
      expect((el.querySelector('#track-artist') as HTMLInputElement).placeholder).toBe('Unknown artist');
      expect(el.querySelector('.cover-preview')?.getAttribute('src')).toBe('blob:preview');
      // La pochette n'ouvre plus l'explorateur de fichiers.
      expect(el.querySelector('.cover-box input')).toBeNull();
      expect(el.querySelector('#track-genre')).toBeNull();
      const info = el.querySelector('.info-grid')?.textContent ?? '';
      expect(info).toContain('MP3');
      expect(info).toContain('3:00');
      expect(info).toContain('160 kb/s');
      expect(el.querySelector('.file-row-name')?.textContent).toContain('song.mp3');

      view.toggleEditing();
      fixture.detectChanges();
      expect(titleInput().readOnly).toBe(false);
    });
  });

  it('envoie les détails sans pochette ni genre, puis revient à l’étape 1', () => {
    component.file.set(audioFile());
    component.form.setValue({ title: 'T', artist: 'A', album: 'B' });
    component.upload();

    const req = http.expectOne('/api/tracks');
    const body = req.request.body as FormData;
    expect(body.get('title')).toBe('T');
    expect(body.get('artist')).toBe('A');
    expect(body.get('album')).toBe('B');
    // La pochette intégrée et le genre sont relus par l'API dans le fichier.
    expect(body.has('genre')).toBe(false);
    expect(body.has('cover')).toBe(false);
    expect(component.form.disabled).toBe(true);

    req.flush(track, { status: 201, statusText: 'Created' });
    http.expectOne('/api/tracks?page=1&limit=5').flush(page);
    expect(component.form.getRawValue()).toEqual({ title: '', artist: '', album: '' });
    expect(component.form.enabled).toBe(true);
    expect(component.file()).toBeUndefined();
  });

  it('laisse le serveur lire les tags quand les champs sont vides', () => {
    component.file.set(audioFile());
    component.upload();
    const body = http.expectOne('/api/tracks').request.body as FormData;
    expect(body.has('title')).toBe(false);
    expect(body.has('cover')).toBe(false);
  });

  it('n’envoie rien sans fichier', () => {
    component.upload();
    http.expectNone('/api/tracks');
  });

  it('ouvre la page lecteur au clic sur Play', () => {
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.play(track);
    expect(navigate).toHaveBeenCalledWith(['/tracks', '1']);
  });

  it('affiche la pochette, l’artiste, l’album et la durée de chaque piste', () => {
    const fixture = TestBed.createComponent(TracksPageComponent);
    const rich = { ...track, artist: 'Miles', album: 'Kind of Blue', duration: 125, hasCover: true };
    http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, items: [rich] });
    fixture.detectChanges();
    http.expectOne('/api/tracks/1/cover').flush(new Blob(['img']));
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.track-card') as HTMLElement;
    expect(card.querySelector('app-track-cover img')?.getAttribute('src')).toBe('blob:preview');
    expect(card.querySelector('.track-artist')?.textContent).toContain('Miles');
    expect(card.querySelector('.track-artist')?.textContent).toContain('Kind of Blue');
    expect(card.textContent).toContain('2:05');
  });

  it('affiche le nom du fichier quand artiste et album sont inconnus', () => {
    const fixture = TestBed.createComponent(TracksPageComponent);
    http.expectOne('/api/tracks?page=1&limit=5').flush(page);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('.track-card') as HTMLElement;
    expect(card.querySelector('.track-artist')).toBeNull();
    expect(card.querySelector('.track-filename')?.textContent).toContain('test.mp3');
  });

  it('affiche un état vide et la pagination', () => {
    const fixture = TestBed.createComponent(TracksPageComponent);
    http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, items: [], total: 0 });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No tracks yet');

    const paged = TestBed.createComponent(TracksPageComponent);
    http.expectOne('/api/tracks?page=1&limit=5').flush({ ...page, total: 12 });
    paged.detectChanges();
    expect(paged.nativeElement.querySelector('.page-info').textContent).toContain('1 / 3');
  });

  it('navigue entre les pages sans sortir des bornes', () => {
    component.total.set(12);
    component.go(0);
    component.go(4);
    http.expectNone(() => true);
    component.go(2);
    http.expectOne('/api/tracks?page=2&limit=5').flush({ ...page, total: 12 });
    expect(component.page()).toBe(2);
  });
});

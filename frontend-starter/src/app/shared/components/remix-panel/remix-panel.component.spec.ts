import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemixRenderService } from '@/shared/services/remix-render.service';
import { POLL_INTERVAL, RemixPanelComponent } from './remix-panel.component';
import { Track, VocalsStatus } from '@/shared/models/track.model';

describe('RemixPanelComponent', () => {
  let fixture: ComponentFixture<RemixPanelComponent>;
  let component: RemixPanelComponent;
  let http: HttpTestingController;
  let urls = 0;
  const createObjectURL = vi.fn(() => `blob:remix-${++urls}`);
  const revokeObjectURL = vi.fn();
  let play: ReturnType<typeof vi.spyOn>;
  const renderer = { render: vi.fn() };

  const track = (id: string, vocalsStatus: VocalsStatus = 'none', title = 'Song'): Track => ({
    id,
    title,
    originalName: `${id}.mp3`,
    mimeType: 'audio/mpeg',
    size: 1,
    createdAt: '2026-01-01',
    vocalsStatus,
  });

  beforeEach(() => {
    urls = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // jsdom n'implémente pas la lecture : on simule play/pause.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    renderer.render.mockReset().mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: RemixRenderService, useValue: renderer },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const create = (status: VocalsStatus = 'none') => {
    fixture = TestBed.createComponent(RemixPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('track', track('t1', status));
    fixture.detectChanges();
  };
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const audios = () => el().querySelectorAll('audio');

  /** Answers the requests made once the vocals are ready: the vocals and the beats list. */
  const respondReady = (beats: Track[] = [track('t1'), track('b1', 'none', 'Beat')]) => {
    http.expectOne('/api/tracks/t1/vocals').flush(new Blob(['voix']));
    http.expectOne((r) => r.url === '/api/tracks').flush({ items: beats, page: 1, limit: 20, total: beats.length, pages: 1 });
    fixture.detectChanges();
  };
  const chooseBeat = (id = 'b1') => {
    const select = el().querySelector('select')!;
    select.value = id;
    select.dispatchEvent(new Event('change'));
    if (id) http.expectOne(`/api/tracks/${id}/audio`).flush(new Blob(['beat']));
    fixture.detectChanges();
  };
  const range = (name: string) =>
    [...el().querySelectorAll('label.field')]
      .find((label) => label.querySelector('.field-name')?.textContent === name && label.querySelector('input'))!
      .querySelector('input') as HTMLInputElement;
  const slide = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('propose d’extraire la voix quand elle ne l’est pas encore', () => {
    create();
    expect(text()).toContain('Extraire la voix (IA)');
    expect(audios()).toHaveLength(0);
  });

  it('lance la séparation, attend la fin puis charge la voix', () => {
    vi.useFakeTimers();
    create();
    (el().querySelector('button') as HTMLButtonElement).click();
    const request = http.expectOne('/api/tracks/t1/vocals');
    expect(request.request.method).toBe('POST');
    request.flush(track('t1', 'processing'), { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    expect(text()).toContain('Séparation en cours');

    vi.advanceTimersByTime(POLL_INTERVAL);
    http.expectOne('/api/tracks/t1').flush(track('t1', 'processing'));
    vi.advanceTimersByTime(POLL_INTERVAL);
    http.expectOne('/api/tracks/t1').flush(track('t1', 'ready'));
    expect(component.status()).toBe('ready');
    respondReady();

    // Le suivi s'arrête une fois la voix prête.
    vi.advanceTimersByTime(POLL_INTERVAL * 3);
    http.expectNone('/api/tracks/t1');
    expect(text()).toContain('Télécharger l’acapella');
  });

  it('reprend le suivi d’une séparation déjà en cours', () => {
    vi.useFakeTimers();
    create('processing');
    vi.advanceTimersByTime(POLL_INTERVAL);
    http.expectOne('/api/tracks/t1').flush(track('t1', 'failed'));
    fixture.detectChanges();
    expect(text()).toContain('La séparation a échoué');
    // Après un échec, on peut relancer.
    expect(text()).toContain('Extraire la voix (IA)');
  });

  it('affiche le message de l’API si la séparation est refusée', () => {
    create();
    component.extract();
    http.expectOne('/api/tracks/t1/vocals').flush({ message: 'Séparation déjà en cours' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(text()).toContain('Séparation déjà en cours');
    expect(component.busy()).toBe(false);
  });

  it('propose les autres pistes comme prod et permet de télécharger l’acapella', () => {
    create('ready');
    respondReady();
    const options = [...el().querySelectorAll('option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Choisir une piste…', 'Beat']);
    const link = el().querySelector('a[download]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('blob:remix-1');
    expect(link.getAttribute('download')).toBe('Song (voix).mp3');
  });

  it('invite à ajouter une piste si la bibliothèque n’a pas d’autre prod', () => {
    create('ready');
    respondReady([track('t1')]);
    expect(text()).toContain('Ajoute une autre piste');
  });

  it('lit la voix et la prod ensemble, synchronisées', async () => {
    create('ready');
    respondReady();
    const started = vi.fn();
    component.started.subscribe(started);
    expect(component.ready()).toBe(false);
    chooseBeat();
    expect(component.ready()).toBe(true);

    const [vocals, beat] = audios();
    slide(range('Début prod'), '4');
    slide(range('Tempo prod'), '1.1');
    vocals.currentTime = 10;
    component.toggle();
    await new Promise((resolve) => setTimeout(resolve));

    expect(started).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(2);
    expect(component.playing()).toBe(true);
    // Prod = début + position de la voix × tempo, tonalité conservée.
    expect(beat.currentTime).toBeCloseTo(4 + 10 * 1.1);
    expect(beat.playbackRate).toBe(1.1);
    expect(beat.preservesPitch).toBe(true);

    component.toggle();
    expect(component.playing()).toBe(false);
  });

  it('recale la prod seulement quand elle dérive', () => {
    create('ready');
    respondReady();
    chooseBeat();
    const [vocals, beat] = audios();
    vocals.currentTime = 20;
    beat.currentTime = 20.1;
    vocals.dispatchEvent(new Event('timeupdate'));
    expect(beat.currentTime).toBe(20.1);
    expect(component.currentTime()).toBe(20);

    beat.currentTime = 25;
    vocals.dispatchEvent(new Event('timeupdate'));
    expect(beat.currentTime).toBe(20);
  });

  it('se positionne dans le remix et règle les volumes', () => {
    create('ready');
    respondReady();
    chooseBeat();
    const [vocals, beat] = audios();
    // jsdom ne lit pas l'audio : la durée est fournie à la main.
    component.duration.set(60);
    fixture.detectChanges();
    slide(el().querySelector('input.position') as HTMLInputElement, '30');
    expect(vocals.currentTime).toBe(30);
    expect(beat.currentTime).toBe(30);

    slide(range('Voix'), '0.5');
    slide(range('Prod'), '0.25');
    expect(vocals.volume).toBe(0.5);
    expect(beat.volume).toBe(0.25);
  });

  it('change de prod en libérant la précédente', () => {
    create('ready');
    respondReady([track('t1'), track('b1'), track('b2')]);
    chooseBeat('b1');
    chooseBeat('b2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:remix-2');
    chooseBeat('');
    expect(component.beatUrl()).toBeNull();
  });

  it('supprime la voix et revient au bouton d’extraction', () => {
    create('ready');
    respondReady();
    component.deleteVocals();
    const request = http.expectOne('/api/tracks/t1/vocals');
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    fixture.detectChanges();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:remix-1');
    expect(text()).toContain('Extraire la voix (IA)');
  });

  it('libère les URL et arrête le suivi à la destruction', () => {
    vi.useFakeTimers();
    create('ready');
    respondReady();
    chooseBeat();
    fixture.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:remix-1');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:remix-2');
  });

  describe('ajout à la bibliothèque', () => {
    const saveButton = () =>
      [...el().querySelectorAll('button')].find((b) => b.textContent?.includes('Ajouter à la bibliothèque')) as HTMLButtonElement;
    /** Waits for the render promise, then answers the upload. */
    const respondUpload = async (body: Track | null = track('r1', 'none', 'Mon remix'), status = 201) => {
      // expectOne throws until the upload is sent, then returns it (only once).
      const request = await vi.waitFor(() => http.expectOne('/api/tracks'));
      request.flush(body ?? { message: 'Format audio non accepté' }, { status, statusText: 'x' });
      return request.request;
    };
    const flushPromises = () => new Promise((resolve) => setTimeout(resolve));

    it('n’est possible qu’une fois la prod choisie', () => {
      create('ready');
      respondReady();
      expect(saveButton().disabled).toBe(true);
      expect(component.defaultTitle()).toBe('Song (remix)');
      chooseBeat();
      expect(saveButton().disabled).toBe(false);
      expect((el().querySelector('.title-input') as HTMLInputElement).placeholder).toBe('Song (remix sur Beat)');
    });

    it('crée le MP3 avec les réglages puis l’envoie comme une nouvelle piste', async () => {
      fixture = TestBed.createComponent(RemixPanelComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('track', { ...track('t1', 'ready'), artist: 'Moi' });
      fixture.detectChanges();
      respondReady();
      chooseBeat();
      slide(range('Tempo prod'), '1.2');
      slide(range('Début prod'), '2');
      const title = el().querySelector('.title-input') as HTMLInputElement;
      title.value = '  Mon remix ';
      title.dispatchEvent(new Event('input'));

      saveButton().click();
      expect(component.saving()).toBe('rendering');
      const request = await respondUpload();
      await flushPromises();
      fixture.detectChanges();

      const [vocals, beat, settings] = renderer.render.mock.calls[0];
      expect(await (vocals as Blob).text()).toBe('voix');
      expect(await (beat as Blob).text()).toBe('beat');
      expect(settings).toEqual({ vocalsVolume: 1, beatVolume: 0.8, beatSpeed: 1.2, beatStart: 2 });

      const body = request.body as FormData;
      const file = body.get('audio') as File;
      expect(file.name).toBe('Mon remix.mp3');
      expect(file.type).toBe('audio/mpeg');
      expect(body.get('title')).toBe('Mon remix');
      expect(body.get('artist')).toBe('Moi');

      expect(component.saving()).toBeNull();
      const link = el().querySelector('.saved-link') as HTMLAnchorElement;
      expect(link.textContent).toContain('Mon remix');
      expect(link.getAttribute('href')).toBe('/tracks/r1');
    });

    it('utilise le titre par défaut quand le champ est vide', async () => {
      create('ready');
      respondReady();
      chooseBeat();
      void component.save();
      const request = await respondUpload();
      expect((request.body as FormData).get('title')).toBe('Song (remix sur Beat)');
    });

    it('affiche l’erreur de l’API si l’envoi échoue', async () => {
      create('ready');
      respondReady();
      chooseBeat();
      void component.save();
      await respondUpload(null, 400);
      await flushPromises();
      fixture.detectChanges();
      expect(text()).toContain('Format audio non accepté');
      expect(component.saving()).toBeNull();
    });

    it('affiche une erreur si le navigateur ne peut pas créer le remix', async () => {
      renderer.render.mockRejectedValue(new Error('decode'));
      create('ready');
      respondReady();
      chooseBeat();
      await component.save();
      fixture.detectChanges();
      expect(text()).toContain('Impossible de créer le remix');
      http.expectNone('/api/tracks');
    });
  });
});

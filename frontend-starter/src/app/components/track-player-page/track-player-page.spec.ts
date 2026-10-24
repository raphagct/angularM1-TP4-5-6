import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrackPlayerPageComponent } from './track-player-page';
import { AudioAnalysisService } from '@/shared/services/audio-analysis.service';
import { Track } from '@/shared/models/track.model';
import { RemixPanelComponent } from '@/shared/components/remix-panel';
import { By } from '@angular/platform-browser';

describe('TrackPlayerPageComponent', () => {
  let harness: RouterTestingHarness;
  let component: TrackPlayerPageComponent;
  let http: HttpTestingController;
  let urls = 0;
  const analysis = { peaks: vi.fn() };
  const createObjectURL = vi.fn(() => `blob:audio-${++urls}`);
  const revokeObjectURL = vi.fn();
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;

  const track: Track = {
    id: 't1',
    title: 'Blue in Green',
    artist: 'Miles Davis',
    album: 'Kind of Blue',
    genre: 'Jazz',
    year: 1959,
    duration: 200,
    bitrate: 320000,
    sampleRate: 44100,
    hasCover: false,
    originalName: 'blue.mp3',
    mimeType: 'audio/mpeg',
    size: 5 * 1024 * 1024,
    createdAt: '2026-01-01',
  };

  beforeEach(async () => {
    urls = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    analysis.peaks.mockReset().mockResolvedValue([0.2, 1, 0.5]);
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    // jsdom n'implémente pas la lecture : on simule play/pause.
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'tracks/:id', component: TrackPlayerPageComponent },
          { path: 'elsewhere', children: [] },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AudioAnalysisService, useValue: analysis },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    component = await harness.navigateByUrl('/tracks/t1', TrackPlayerPageComponent);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  /** Answers the two requests of the page: metadata and audio. */
  const respond = (id = 't1', data: Track = track) => {
    http.expectOne(`/api/tracks/${id}`).flush(data);
    http.expectOne(`/api/tracks/${id}/audio`).flush(new Blob(['audio']));
    harness.detectChanges();
  };
  const text = () => harness.routeNativeElement!.textContent ?? '';
  const audio = () => harness.routeNativeElement!.querySelector('audio') as HTMLAudioElement;

  it('affiche un squelette pendant le chargement', () => {
    expect(component.loading()).toBe(true);
    expect(harness.routeNativeElement!.querySelector('.cover-skeleton')).not.toBeNull();
    respond();
  });

  it('affiche la pochette, le titre et toutes les métadonnées', () => {
    respond();
    expect(component.loading()).toBe(false);
    expect(text()).toContain('Blue in Green');
    expect(text()).toContain('Miles Davis');
    expect(text()).toContain('Kind of Blue');
    expect(text()).toContain('Jazz');
    expect(text()).toContain('1959');
    expect(text()).toContain('3:20');
    expect(text()).toContain('320 kbps · 44.1 kHz');
    expect(text()).toContain('5.0 Mo');
    expect(harness.routeNativeElement!.querySelector('app-track-cover')).not.toBeNull();
  });

  it('masque les métadonnées absentes', () => {
    respond('t1', { ...track, artist: undefined, album: undefined, genre: undefined, year: undefined, bitrate: undefined, sampleRate: undefined });
    expect(text()).not.toContain('Album');
    expect(text()).not.toContain('Genre');
    expect(text()).not.toContain('Quality');
    expect(component.quality()).toBe('');
  });

  it('crée une URL blob pour le lecteur audio en lecture automatique', () => {
    respond();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(audio().getAttribute('src')).toBe('blob:audio-1');
    expect(audio().autoplay).toBe(true);
  });

  it('calcule la forme d’onde à partir du même blob puis l’affiche', async () => {
    respond();
    expect(analysis.peaks).toHaveBeenCalledWith(expect.any(Blob));
    await vi.waitFor(() => expect(component.peaks()).toEqual([0.2, 1, 0.5]));
    harness.detectChanges();
    expect(component.analysing()).toBe(false);
    expect(harness.routeNativeElement!.querySelector('app-waveform')).not.toBeNull();
    expect(harness.routeNativeElement!.querySelector('.waveform-skeleton')).toBeNull();
  });

  it('affiche « Analyse du son… » pendant le décodage', () => {
    analysis.peaks.mockReturnValue(new Promise(() => undefined));
    respond();
    expect(component.analysing()).toBe(true);
    expect(text()).toContain('Analyse du son…');
  });

  it('utilise une ligne plate cliquable si le décodage échoue', async () => {
    analysis.peaks.mockRejectedValue(new Error('EncodingError'));
    respond();
    await vi.waitFor(() => expect(component.waveformError()).toBe(true));
    harness.detectChanges();
    expect(component.waveformPeaks()).toHaveLength(200);
    expect(text()).toContain('Forme d’onde indisponible');
    expect(harness.routeNativeElement!.querySelector('app-waveform')).not.toBeNull();
  });

  it('affiche « Piste introuvable » pour une 404', () => {
    http.expectOne('/api/tracks/t1').flush({}, { status: 404, statusText: 'Not Found' });
    http.expectOne('/api/tracks/t1/audio').error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(component.loading()).toBe(false);
    expect(component.track()).toBeNull();
    // L'erreur audio arrive en dernier mais ne remplace pas le message plus précis.
    expect(text()).toContain('Piste introuvable.');
    expect(text()).not.toContain('Impossible de lire la piste.');
  });

  it('affiche une erreur générique pour une erreur serveur', () => {
    http.expectOne('/api/tracks/t1').flush({}, { status: 500, statusText: 'Error' });
    http.expectOne('/api/tracks/t1/audio').flush(new Blob(['a']));
    harness.detectChanges();
    expect(text()).toContain('Impossible de charger la piste.');
  });

  it('affiche une erreur si l’audio est indisponible', () => {
    http.expectOne('/api/tracks/t1').flush(track);
    http.expectOne('/api/tracks/t1/audio').error(new ProgressEvent('error'), { status: 500, statusText: 'Error' });
    harness.detectChanges();
    expect(text()).toContain('Impossible de lire la piste.');
    expect(audio()).toBeNull();
  });

  it('lance et met en pause la lecture', () => {
    respond();
    Object.defineProperty(audio(), 'paused', { configurable: true, value: true });
    component.toggle();
    expect(play).toHaveBeenCalled();

    Object.defineProperty(audio(), 'paused', { configurable: true, value: false });
    component.toggle();
    expect(pause).toHaveBeenCalled();
  });

  it('ne fait rien sans élément audio', () => {
    component.toggle();
    component.seek(0.5);
    expect(play).not.toHaveBeenCalled();
    respond();
  });

  it('suit les événements play / pause / ended de l’élément audio', () => {
    respond();
    audio().dispatchEvent(new Event('play'));
    expect(component.playing()).toBe(true);
    harness.detectChanges();
    expect(text()).toContain('NOW PLAYING');

    audio().currentTime = 42;
    audio().dispatchEvent(new Event('pause'));
    expect(component.playing()).toBe(false);
    expect(component.currentTime()).toBe(42);

    audio().dispatchEvent(new Event('ended'));
    expect(component.currentTime()).toBe(200);
  });

  it('met à jour le temps avec timeupdate et calcule la progression', () => {
    respond();
    audio().currentTime = 50;
    audio().dispatchEvent(new Event('timeupdate'));
    harness.detectChanges();
    expect(component.progress()).toBe(0.25);
    expect(text()).toContain('0:50');
  });

  it('préfère la durée réelle du média à celle de l’API', () => {
    respond();
    expect(component.duration()).toBe(200);
    Object.defineProperty(audio(), 'duration', { configurable: true, value: 180 });
    audio().dispatchEvent(new Event('loadedmetadata'));
    expect(component.duration()).toBe(180);
  });

  it('ignore une durée infinie (flux)', () => {
    respond();
    Object.defineProperty(audio(), 'duration', { configurable: true, value: Infinity });
    audio().dispatchEvent(new Event('loadedmetadata'));
    expect(component.duration()).toBe(200);
  });

  it('se positionne quand la forme d’onde demande un seek', () => {
    respond();
    component.seek(0.5);
    expect(audio().currentTime).toBe(100);
    expect(component.currentTime()).toBe(100);
    component.seek(3);
    expect(component.currentTime()).toBe(200);
  });

  it('avance et recule de 10 secondes', () => {
    respond();
    component.seek(0.5);
    component.skip(10);
    expect(component.currentTime()).toBe(110);
    component.skip(-200);
    expect(component.currentTime()).toBe(0);
  });

  it('règle le volume et coupe le son', () => {
    respond();
    const input = harness.routeNativeElement!.querySelector('input[type=range]') as HTMLInputElement;
    input.value = '0.3';
    input.dispatchEvent(new Event('input'));
    expect(component.volume()).toBe(0.3);
    expect(audio().volume).toBe(0.3);

    component.toggleMute();
    expect(component.muted()).toBe(true);
    expect(audio().muted).toBe(true);

    input.value = '0';
    input.dispatchEvent(new Event('input'));
    expect(component.muted()).toBe(true);
  });

  it('la barre d’espace lance la lecture, sauf dans un champ ou un bouton', () => {
    respond();
    Object.defineProperty(audio(), 'paused', { configurable: true, value: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(play).toHaveBeenCalledTimes(1);

    const button = harness.routeNativeElement!.querySelector('button') as HTMLButtonElement;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('le bouton play appelle toggle', () => {
    respond();
    Object.defineProperty(audio(), 'paused', { configurable: true, value: true });
    (harness.routeNativeElement!.querySelector('.play-btn') as HTMLButtonElement).click();
    expect(play).toHaveBeenCalled();
  });

  it('recharge et libère l’ancienne URL quand on change de piste', async () => {
    respond();
    await harness.navigateByUrl('/tracks/t2');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-1');
    expect(component.track()).toBeNull();
    respond('t2', { ...track, id: 't2', title: 'So What' });
    expect(text()).toContain('So What');
    expect(audio().getAttribute('src')).toBe('blob:audio-2');
  });

  it('ignore la forme d’onde d’une piste précédente arrivée en retard', async () => {
    let resolveFirst: (peaks: number[]) => void = () => undefined;
    analysis.peaks.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
    respond();
    await harness.navigateByUrl('/tracks/t2');
    analysis.peaks.mockResolvedValueOnce([0.9]);
    respond('t2', { ...track, id: 't2' });
    await vi.waitFor(() => expect(component.peaks()).toEqual([0.9]));
    resolveFirst([0.1, 0.1]);
    await Promise.resolve();
    expect(component.peaks()).toEqual([0.9]);
  });

  it('libère l’URL audio en quittant la page', async () => {
    respond();
    await harness.navigateByUrl('/elsewhere');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-1');
  });

  it('ne joue jamais le lecteur et le remix en même temps', () => {
    respond();
    const remix = harness.fixture.debugElement.query(By.directive(RemixPanelComponent)).componentInstance as RemixPanelComponent;
    const remixPause = vi.spyOn(remix, 'pause');

    remix.started.emit();
    expect(pause).toHaveBeenCalled();

    audio().dispatchEvent(new Event('play'));
    expect(remixPause).toHaveBeenCalled();
  });

  describe('effets', () => {
    /** jsdom ne fournit pas la Web Audio API : on compte les contextes créés et fermés. */
    const contexts: { close: ReturnType<typeof vi.fn>; wet: { value: number } }[] = [];
    class FakeAudioContext {
      sampleRate = 100;
      state = 'running';
      destination = {};
      close = vi.fn(async () => undefined);
      wet = { value: 0 };
      private gains = 0;
      constructor() {
        contexts.push(this);
      }
      createMediaElementSource = () => ({ connect: (target: unknown) => target });
      createConvolver = () => ({ connect: (target: unknown) => target });
      // The second gain created by ReverbChain is the wet one.
      createGain = () => ({ connect: (target: unknown) => target, gain: this.gains++ === 1 ? this.wet : { value: 0 } });
      createBuffer = (channels: number, length: number) => ({
        numberOfChannels: channels,
        getChannelData: () => new Float32Array(length),
      });
    }

    beforeEach(() => {
      contexts.length = 0;
      vi.stubGlobal('AudioContext', FakeAudioContext);
    });
    afterEach(() => vi.unstubAllGlobals());

    const range = (name: string) =>
      [...harness.routeNativeElement!.querySelectorAll('label.effect')]
        .find((label) => label.textContent?.includes(name))!
        .querySelector('input') as HTMLInputElement;
    const presetButton = (label: string) =>
      [...harness.routeNativeElement!.querySelectorAll('.presets button')].find(
        (button) => button.textContent?.trim() === label,
      ) as HTMLButtonElement;

    it('change la vitesse et, par défaut, la tonalité avec', () => {
      respond();
      const input = range('Vitesse');
      input.value = '1.25';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();

      expect(component.speed()).toBe(1.25);
      expect(audio().playbackRate).toBe(1.25);
      expect(audio().defaultPlaybackRate).toBe(1.25);
      expect(audio().preservesPitch).toBe(false);
      expect(text()).toContain('1.25×');
    });

    it('peut conserver la tonalité', () => {
      respond();
      const checkbox = harness.routeNativeElement!.querySelector('.pitch input') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      expect(component.keepPitch()).toBe(true);
      expect(audio().preservesPitch).toBe(true);
    });

    it('ne passe par la Web Audio API qu’une fois la reverb activée', () => {
      respond();
      component.onLoadedMetadata();
      expect(contexts).toHaveLength(0);

      const input = range('Reverb');
      input.value = '0.5';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      expect(contexts).toHaveLength(1);
      expect(contexts[0].wet.value).toBe(0.5);
      expect(text()).toContain('50 %');

      // Le même élément audio ne peut être branché qu’une fois.
      input.value = '0.2';
      input.dispatchEvent(new Event('input'));
      expect(contexts).toHaveLength(1);
      expect(contexts[0].wet.value).toBe(0.2);
    });

    it('applique les préréglages et met en avant celui qui est actif', () => {
      respond();
      presetButton('Slowed + reverb').click();
      harness.detectChanges();

      expect(component.speed()).toBe(0.85);
      expect(component.reverb()).toBe(0.6);
      expect(audio().playbackRate).toBe(0.85);
      expect(component.activePreset()).toBe('Slowed + reverb');
      expect(presetButton('Slowed + reverb').getAttribute('aria-pressed')).toBe('true');

      presetButton('Original').click();
      expect(component.speed()).toBe(1);
      expect(contexts[0].wet.value).toBe(0);
    });

    it('n’affiche aucun préréglage actif pour un réglage personnalisé', () => {
      respond();
      const input = range('Vitesse');
      input.value = '0.6';
      input.dispatchEvent(new Event('input'));
      expect(component.activePreset()).toBeNull();
    });

    it('garde les effets en changeant de piste et ferme l’ancien contexte', async () => {
      respond();
      component.applyPreset(component.presets[2]);
      expect(contexts).toHaveLength(1);

      await harness.navigateByUrl('/tracks/t2');
      expect(contexts[0].close).toHaveBeenCalled();
      respond('t2', { ...track, id: 't2' });
      component.onLoadedMetadata();
      expect(audio().playbackRate).toBe(0.85);
      expect(contexts).toHaveLength(2);
    });

    it('ferme le contexte audio en quittant la page', async () => {
      respond();
      component.applyPreset(component.presets[2]);
      await harness.navigateByUrl('/elsewhere');
      expect(contexts[0].close).toHaveBeenCalled();
    });

    it('ignore la reverb si le navigateur ne fournit pas la Web Audio API', () => {
      vi.stubGlobal('AudioContext', undefined);
      respond();
      expect(() => component.applyPreset(component.presets[2])).not.toThrow();
      expect(audio().playbackRate).toBe(0.85);
    });
  });
});

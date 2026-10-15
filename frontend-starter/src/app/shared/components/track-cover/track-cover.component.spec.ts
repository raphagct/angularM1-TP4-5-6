import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TrackCoverComponent } from './track-cover.component';

describe('TrackCoverComponent', () => {
  let fixture: ComponentFixture<TrackCoverComponent>;
  let http: HttpTestingController;
  let counter = 0;
  const createObjectURL = vi.fn(() => `blob:cover-${++counter}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    counter = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // jsdom n'implémente pas les URL blob:.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    TestBed.configureTestingModule({
      imports: [TrackCoverComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TrackCoverComponent);
  });

  afterEach(() => http.verify());

  const render = (inputs: { trackId: string; hasCover?: boolean; alt?: string }) => {
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  };
  const img = () => fixture.nativeElement.querySelector('img') as HTMLImageElement | null;
  const placeholder = () => fixture.nativeElement.querySelector('.placeholder') as HTMLElement | null;

  it('affiche un placeholder sans requête quand la piste n’a pas de pochette', () => {
    render({ trackId: '1', hasCover: false, alt: 'Pochette de A' });
    http.expectNone('/api/tracks/1/cover');
    expect(img()).toBeNull();
    expect(placeholder()?.getAttribute('aria-label')).toBe('Pochette de A');
  });

  it('télécharge la pochette et l’affiche via une URL blob', () => {
    render({ trackId: '1', hasCover: true, alt: 'Pochette de A' });
    const req = http.expectOne('/api/tracks/1/cover');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['png']));
    fixture.detectChanges();

    expect(img()?.getAttribute('src')).toBe('blob:cover-1');
    expect(img()?.alt).toBe('Pochette de A');
    expect(placeholder()).toBeNull();
  });

  it('revient au placeholder si le téléchargement échoue', () => {
    render({ trackId: '1', hasCover: true });
    http.expectOne('/api/tracks/1/cover').error(new ProgressEvent('error'), { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(img()).toBeNull();
    expect(placeholder()).not.toBeNull();
  });

  it('libère l’ancienne URL et recharge quand la piste change', () => {
    render({ trackId: '1', hasCover: true });
    http.expectOne('/api/tracks/1/cover').flush(new Blob(['a']));
    fixture.detectChanges();

    render({ trackId: '2', hasCover: true });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-1');
    http.expectOne('/api/tracks/2/cover').flush(new Blob(['b']));
    fixture.detectChanges();
    expect(img()?.getAttribute('src')).toBe('blob:cover-2');
  });

  it('annule une requête en cours quand la piste change', () => {
    render({ trackId: '1', hasCover: true });
    const first = http.expectOne('/api/tracks/1/cover');
    render({ trackId: '2', hasCover: true });
    expect(first.cancelled).toBe(true);
    http.expectOne('/api/tracks/2/cover').flush(new Blob(['b']));
  });

  it('libère l’URL à la destruction', () => {
    render({ trackId: '1', hasCover: true });
    http.expectOne('/api/tracks/1/cover').flush(new Blob(['a']));
    fixture.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cover-1');
  });
});

import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpEvent, HttpEventType, provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TrackService } from './track.service';
import { Track } from '../models/track.model';

describe('TrackService', () => {
  let service: TrackService;
  let httpTesting: HttpTestingController;
  const mockTrack: Track = {
    id: '1',
    title: 'Test Track',
    originalName: 'test.mp3',
    mimeType: 'audio/mp3',
    size: 0,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TrackService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TrackService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should list tracks with pagination params', () => {
    service.list(2, 10).subscribe();
    const req = httpTesting.expectOne('/api/tracks?page=2&limit=10');
    expect(req.request.method).toEqual('GET');
    expect(req.request.params.get('page')).toEqual('2');
    expect(req.request.params.get('limit')).toEqual('10');
    req.flush({ items: [], total: 0 });
  });

  it('should use page 1 and limit 5 by default', () => {
    service.list().subscribe();
    httpTesting.expectOne('/api/tracks?page=1&limit=5').flush({ items: [], total: 0 });
  });

  it('should get a single track', () => {
    let result: Track | undefined;
    service.get('42').subscribe((track) => (result = track));
    const req = httpTesting.expectOne('/api/tracks/42');
    expect(req.request.method).toBe('GET');
    req.flush(mockTrack);
    expect(result).toEqual(mockTrack);
  });

  it('should upload a file with its details and report progress', () => {
    const mockFile = new File([''], 'test.mp3', { type: 'audio/mp3' });
    const cover = new File(['img'], 'cover.png', { type: 'image/png' });
    let responseEvent: HttpEvent<Track> | undefined;

    service
      .upload(mockFile, { title: 'Test Track', artist: ' Artist ', album: 'Album', genre: 'Rock', cover })
      .subscribe((event) => (responseEvent = event));

    const req = httpTesting.expectOne('/api/tracks');
    const body = req.request.body as FormData;
    expect(req.request.method).toEqual('POST');
    expect(body instanceof FormData).toBe(true);
    expect(body.get('audio')).toEqual(mockFile);
    expect(body.get('title')).toEqual('Test Track');
    expect(body.get('artist')).toEqual('Artist');
    expect(body.get('album')).toEqual('Album');
    expect(body.get('genre')).toEqual('Rock');
    expect(body.get('cover')).toEqual(cover);
    expect(req.request.reportProgress).toBe(true);

    req.flush(mockTrack);

    expect(responseEvent?.type).toBe(HttpEventType.Response);
    if (responseEvent?.type === HttpEventType.Response) expect(responseEvent.body).toEqual(mockTrack);
  });

  it('should not send empty fields or a missing cover', () => {
    service.upload(new File([''], 'a.mp3'), { title: '  ', artist: '', cover: null }).subscribe();
    const body = httpTesting.expectOne('/api/tracks').request.body as FormData;
    expect(body.has('audio')).toBe(true);
    for (const key of ['title', 'artist', 'album', 'genre', 'cover']) expect(body.has(key)).toBe(false);
  });

  it('should upload without details', () => {
    service.upload(new File([''], 'a.mp3')).subscribe();
    const body = httpTesting.expectOne('/api/tracks').request.body as FormData;
    expect([...body.keys()]).toEqual(['audio']);
  });

  it('should download the audio as a blob', () => {
    service.audio('7').subscribe();
    const req = httpTesting.expectOne('/api/tracks/7/audio');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });

  it('should download the cover as a blob', () => {
    service.cover('7').subscribe();
    const req = httpTesting.expectOne('/api/tracks/7/cover');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
  });

  it('should delete a track', () => {
    service.delete('9').subscribe();
    const req = httpTesting.expectOne('/api/tracks/9');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });
});

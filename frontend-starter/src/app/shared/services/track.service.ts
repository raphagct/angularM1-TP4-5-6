import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Page } from '../models/page.model';
import { Track, TrackUploadDetails } from '../models/track.model';
import { Observable } from 'rxjs';

/** Encapsulates all HTTP operations for backing tracks. */
@Injectable({ providedIn: 'root' })
export class TrackService {
  private readonly http = inject(HttpClient);

  list(page = 1, limit = 5) {
    return this.http.get<Page<Track>>('/api/tracks', {
      params: { page, limit },
    });
  }

  get(id: string) {
    return this.http.get<Track>(`/api/tracks/${id}`);
  }

  upload(file: File, details: TrackUploadDetails = {}): Observable<HttpEvent<Track>> {
    const body = new FormData();
    body.append('audio', file);
    // Empty fields are not sent so the API can use the tags read from the file.
    for (const key of ['title', 'artist', 'album', 'genre'] as const) {
      const value = details[key]?.trim();
      if (value) body.append(key, value);
    }
    if (details.cover) body.append('cover', details.cover);
    return this.http.post<Track>('/api/tracks', body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  audio(id: string) {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  /** The cover is fetched as a blob because an <img> cannot send the JWT header. */
  cover(id: string) {
    return this.http.get(`/api/tracks/${id}/cover`, {
      responseType: 'blob',
    });
  }

  delete(id: string) {
    return this.http.delete(`/api/tracks/${id}`);
  }
}

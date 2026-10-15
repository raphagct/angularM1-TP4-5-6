import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Page } from '../models/page.model';
import { Track } from '../models/track.model';
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

  upload(file: File, title: string): Observable<HttpEvent<Track>> {
    const body = new FormData();
    body.append('audio', file);
    body.append('title', title);
    return this.http.post<Track>('/api/tracks', body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  cover(id: string) {
    return this.http.get(`/api/tracks/${id}/cover`, { responseType: 'blob' });
  }

  audio(id: string) {
    return this.http.get(`/api/tracks/${id}/audio`, {
      responseType: 'blob',
    });
  }

  delete(id: string) {
    return this.http.delete(`/api/tracks/${id}`);
  }
}

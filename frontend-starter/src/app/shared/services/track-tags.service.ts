import { Injectable } from '@angular/core';
import type { IAudioMetadata } from 'music-metadata';

/** Tags read from an audio file, used to pre-fill the upload form. */
export interface TrackTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  /** Embedded cover, converted to a File so it can be sent like a chosen one. */
  cover: File | null;
  /** Duration in seconds (estimated from the header for some formats). */
  duration?: number;
  /** Bitrate in bits per second. */
  bitrate?: number;
  /** Sample rate in Hz. */
  sampleRate?: number;
}

/** Keeps a finite, positive number, otherwise undefined. */
function positive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

const COVER_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Returns the first non-empty trimmed string, otherwise undefined. */
function text(...candidates: (string | undefined)[]): string | undefined {
  return candidates.map((value) => value?.trim()).find(Boolean);
}

/** Maps raw music-metadata output to the form fields; pure, easy to test. */
export function toTrackTags(raw: IAudioMetadata): TrackTags {
  const common = raw.common;
  const picture = common.picture?.find((p) => p.data?.length > 0);
  // Some encoders write "jpg" or "image/jpg" instead of a real MIME type.
  const format = picture?.format.toLowerCase() ?? '';
  const mime = (format.includes('/') ? format : `image/${format}`).replace('image/jpg', 'image/jpeg');
  const extension = COVER_EXTENSIONS[mime];

  return {
    title: text(common.title),
    artist: text(common.artist, common.albumartist),
    album: text(common.album),
    genre: text(...(common.genre ?? [])),
    cover: picture && extension
      ? new File([picture.data as Uint8Array<ArrayBuffer>], `cover.${extension}`, { type: mime })
      : null,
    duration: positive(raw.format.duration),
    bitrate: positive(raw.format.bitrate),
    sampleRate: positive(raw.format.sampleRate),
  };
}

/** Reads the tags of an audio file directly in the browser, before upload. */
@Injectable({ providedIn: 'root' })
export class TrackTagsService {
  async read(file: Blob): Promise<TrackTags> {
    // Loaded on demand so the parser stays out of the initial bundle.
    const { parseBlob } = await import('music-metadata');
    const tags = toTrackTags(await parseBlob(file, { duration: false, skipCovers: false }));
    console.debug('[TrackTags] Tags lus', tags.title ?? '-', tags.artist ?? '-', Boolean(tags.cover));
    return tags;
  }
}

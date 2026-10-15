/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** True when the API can serve a cover at /api/tracks/:id/cover. */
  hasCover?: boolean;
  artist?: string;
  album?: string;
  genre?: string;
  year?: number;
  /** Duration in seconds. */
  duration?: number;
  /** Bitrate in bits per second. */
  bitrate?: number;
  /** Sample rate in Hz. */
  sampleRate?: number;
}

/** Optional fields sent with an upload; the API falls back to the file tags. */
export interface TrackUploadDetails {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  cover?: File | null;
}

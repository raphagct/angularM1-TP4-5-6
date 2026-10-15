/** Audio track metadata returned by the API. */
export interface Track {
  id: string;
  title: string;
  originalName: string;
  mimeType: string;
  size: number;
  artist?: string;
  album?: string;
  duration?: number;
  hasCover?: boolean;
  createdAt: string;
}

import { describe, it, expect } from 'vitest';
import type { IAudioMetadata } from 'music-metadata';
import { toTrackTags } from './track-tags.service';

const raw = (common: Partial<IAudioMetadata['common']>) => ({ common, format: {} }) as unknown as IAudioMetadata;

describe('toTrackTags', () => {
  it('reprend les tags texte et ignore les valeurs vides', () => {
    const tags = toTrackTags(raw({ title: ' Song ', albumartist: 'Band', album: '', genre: ['', 'Rock'] }));
    expect(tags).toEqual({ title: 'Song', artist: 'Band', album: undefined, genre: 'Rock', cover: null });
  });

  it('convertit la pochette intégrée en File, y compris un format "jpg"', () => {
    const tags = toTrackTags(raw({ picture: [{ format: 'jpg', data: new Uint8Array([1, 2]) }] }));
    expect(tags.cover?.type).toBe('image/jpeg');
    expect(tags.cover?.name).toBe('cover.jpg');
    expect(tags.cover?.size).toBe(2);
  });

  it('reprend la durée, le débit et la fréquence du flux audio', () => {
    const tags = toTrackTags({ common: {}, format: { duration: 179.9, bitrate: 160000, sampleRate: 44100 } } as unknown as IAudioMetadata);
    expect(tags).toMatchObject({ duration: 179.9, bitrate: 160000, sampleRate: 44100 });
    expect(toTrackTags({ common: {}, format: { duration: NaN, bitrate: 0 } } as unknown as IAudioMetadata).duration).toBeUndefined();
  });

  it('ignore une pochette vide ou dans un format non accepté', () => {
    expect(toTrackTags(raw({ picture: [{ format: 'image/png', data: new Uint8Array() }] })).cover).toBeNull();
    expect(toTrackTags(raw({ picture: [{ format: 'image/gif', data: new Uint8Array([1]) }] })).cover).toBeNull();
  });
});

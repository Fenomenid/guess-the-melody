import { describe, expect, it, vi } from 'vitest';
import { prepareTrackAudio, resolveAudioDeliveryMode } from './audioDelivery';
import type { Track } from './types';

const tracks: Track[] = [
  { id: '1', title: 'One', artist: 'Artist', audioUrl: 'https://strm-test.yandex.net/music-v2/raw/track/preview192' },
  { id: '2', title: 'Two', artist: 'Artist', audioUrl: 'https://strm-test.yandex.net/music-v2/raw/track/preview193' },
  { id: '3', title: 'Three', artist: 'Artist', audioUrl: 'https://strm-test.yandex.net/music-v2/raw/track/preview194' },
  { id: '4', title: 'Four', artist: 'Artist', audioUrl: 'https://strm-test.yandex.net/music-v2/raw/track/preview195' }
];

describe('audio delivery', () => {
  it('uses direct browser playback unless cache mode is explicitly enabled', () => {
    expect(resolveAudioDeliveryMode(undefined)).toBe('direct');
    expect(resolveAudioDeliveryMode('direct')).toBe('direct');
    expect(resolveAudioDeliveryMode('cache')).toBe('cache');
  });

  it('keeps upstream audio URLs in direct mode without downloading them through the server', async () => {
    const cacheTrackAudio = vi.fn(async () => '/api/audio/cached');

    const prepared = await prepareTrackAudio('ROOM42', tracks, {
      mode: 'direct',
      cacheTrackAudio
    });

    expect(prepared).toEqual(tracks);
    expect(cacheTrackAudio).not.toHaveBeenCalled();
  });

  it('can still cache audio when cache mode is enabled', async () => {
    const cacheTrackAudio = vi.fn(async (_roomCode: string, audioUrl: string) => `/api/audio/${audioUrl.split('/').at(-1)}`);

    const prepared = await prepareTrackAudio('ROOM42', tracks, {
      mode: 'cache',
      cacheTrackAudio
    });

    expect(cacheTrackAudio).toHaveBeenCalledTimes(4);
    expect(prepared.map((track) => track.audioUrl)).toEqual([
      '/api/audio/preview192',
      '/api/audio/preview193',
      '/api/audio/preview194',
      '/api/audio/preview195'
    ]);
  });
});

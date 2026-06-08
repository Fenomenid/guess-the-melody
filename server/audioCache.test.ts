import { describe, expect, it, vi } from 'vitest';
import { AudioCache } from './audioCache';

function response(body: string, headers: Record<string, string> = {}) {
  return new Response(Buffer.from(body), {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      ...headers
    }
  });
}

describe('AudioCache', () => {
  it('downloads audio once and returns a local URL', async () => {
    const fetcher = vi.fn(async () => response('audio-bytes'));
    const cache = new AudioCache({ fetcher });

    const first = await cache.cacheTrackAudio('ROOM42', 'https://strm-test.yandex.net/music-v2/raw/track/preview192');
    const second = await cache.cacheTrackAudio('ROOM42', 'https://strm-test.yandex.net/music-v2/raw/track/preview192');

    expect(first).toMatch(/^\/api\/audio\/[a-f0-9-]+$/);
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves byte ranges for browser audio elements', async () => {
    const cache = new AudioCache({ fetcher: vi.fn(async () => response('0123456789')) });
    const url = await cache.cacheTrackAudio('ROOM42', 'https://strm-test.yandex.net/music-v2/raw/track/preview192');
    const id = url.split('/').pop()!;

    const result = cache.read(id, 'bytes=2-5');

    expect(result).toBeDefined();
    if (!result) {
      return;
    }
    expect(result.status).toBe(206);
    expect(result.body.toString()).toBe('2345');
    expect(result.headers['Content-Range']).toBe('bytes 2-5/10');
    expect(result.headers['Accept-Ranges']).toBe('bytes');
  });

  it('rejects oversized audio files', async () => {
    const cache = new AudioCache({
      maxBytes: 4,
      fetcher: vi.fn(async () => response('too-large'))
    });

    await expect(cache.cacheTrackAudio('ROOM42', 'https://strm-test.yandex.net/music-v2/raw/track/preview192')).rejects.toThrow('Audio file is too large');
  });

  it('rejects non-https upstream URLs', async () => {
    const fetcher = vi.fn(async () => response('audio-bytes'));
    const cache = new AudioCache({ fetcher });

    await expect(cache.cacheTrackAudio('ROOM42', 'http://strm-test.yandex.net/music-v2/raw/track/preview192')).rejects.toThrow('Only HTTPS audio URLs are allowed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('clears cached entries by room', async () => {
    const cache = new AudioCache({ fetcher: vi.fn(async () => response('audio-bytes')) });
    const url = await cache.cacheTrackAudio('ROOM42', 'https://strm-test.yandex.net/music-v2/raw/track/preview192');
    const id = url.split('/').pop()!;

    cache.clearRoom('ROOM42');

    expect(cache.read(id)).toBeUndefined();
  });

  it('does not clear another room that uses the same upstream URL', async () => {
    const cache = new AudioCache({ fetcher: vi.fn(async () => response('audio-bytes')) });
    const upstreamUrl = 'https://strm-test.yandex.net/music-v2/raw/track/preview192';
    const firstUrl = await cache.cacheTrackAudio('ROOM42', upstreamUrl);
    const secondUrl = await cache.cacheTrackAudio('ROOM99', upstreamUrl);
    const firstId = firstUrl.split('/').pop()!;
    const secondId = secondUrl.split('/').pop()!;

    cache.clearRoom('ROOM42');

    expect(cache.read(firstId)).toBeUndefined();
    expect(cache.read(secondId)).toBeDefined();
  });
});

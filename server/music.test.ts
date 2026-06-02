import { describe, expect, it } from 'vitest';
import { MusicService, createGetFileInfoSign } from './music';

describe('MusicService helpers', () => {
  it('matches the Yandex web smart preview signature format', () => {
    const sign = createGetFileInfoSign({
      ts: 1780349044,
      trackId: 136415276,
      quality: 'smart_preview',
      transport: 'raw'
    });

    expect(sign).toBe('WbEn6/nwhvkV7rLIh9pSFsguLkJr8r7CxIPowgr/hBQ');
  });

  it('includes Russian rap as a quick theme', () => {
    const music = new MusicService();

    expect(music.getThemes()).toContainEqual(
      expect.objectContaining({
        id: 'genre-russian-rap',
        title: 'Русский рэп'
      })
    );
  });
});

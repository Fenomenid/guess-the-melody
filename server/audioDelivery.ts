import type { Track } from './types';

export type AudioDeliveryMode = 'direct' | 'cache';

type PrepareTrackAudioOptions = {
  mode: AudioDeliveryMode;
  cacheTrackAudio: (roomCode: string, upstreamUrl: string) => Promise<string>;
  minPlayable?: number;
  onCacheError?: (track: Track, error: unknown) => void;
};

export function resolveAudioDeliveryMode(value = process.env.AUDIO_DELIVERY_MODE): AudioDeliveryMode {
  return value === 'cache' ? 'cache' : 'direct';
}

export async function prepareTrackAudio(roomCode: string, tracks: Track[], options: PrepareTrackAudioOptions): Promise<Track[]> {
  if (options.mode === 'direct') {
    return tracks;
  }

  const cachedTracks: Track[] = [];
  const batchSize = 4;
  for (let index = 0; index < tracks.length; index += batchSize) {
    const batch = tracks.slice(index, index + batchSize);
    const results = await Promise.all(
      batch.map(async (track) => {
        try {
          return {
            ...track,
            audioUrl: await options.cacheTrackAudio(roomCode, track.audioUrl)
          };
        } catch (error) {
          options.onCacheError?.(track, error);
          return undefined;
        }
      })
    );
    cachedTracks.push(...results.filter((track): track is Track => Boolean(track)));
  }

  if (cachedTracks.length < (options.minPlayable ?? 4)) {
    throw new Error('Could not cache enough playable audio tracks');
  }
  return cachedTracks;
}

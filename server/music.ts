import { createHash } from 'node:crypto';
import type { Theme, Track, TrackMetadata } from './types';

const YANDEX_API_BASE = 'https://api.music.yandex.net';
const DOWNLOAD_SIGN_SALT = 'XGRlBW9FXlekgbPrRHuSiA';

type YandexResponse<T> = {
  result?: T;
};

type YandexTrack = {
  id: string | number;
  title: string;
  coverUri?: string;
  albums?: Array<{ id: string | number }>;
  artists?: Array<{ name: string }>;
};

type YandexTrackShort = {
  track?: YandexTrack;
};

type YandexPlaylist = {
  uid?: string | number;
  kind?: string | number;
  owner?: { id?: string | number; uid?: string | number };
  playlistId?: string;
  id?: string;
  tracks?: Array<YandexTrack | YandexTrackShort>;
};

type ChartResult = {
  chart?: {
    tracks?: Array<{ track?: YandexTrack }>;
  };
};

type MetatagResult = {
  playlists?: YandexPlaylist[];
  tracks?: Array<YandexTrack | YandexTrackShort>;
};

type MetatagPlaylistsResult = {
  playlists?: YandexPlaylist[];
};

type PlaylistResult = YandexPlaylist | { playlist?: YandexPlaylist };

type TrackTrailerResult = {
  track?: YandexTrack;
};

type DownloadInfo = {
  codec?: string;
  bitrateInKbps?: number;
  preview?: boolean;
  downloadInfoUrl?: string;
  direct?: boolean;
  directLink?: string;
};

type ThemeConfig = Theme & {
  chartId?: 'russia' | 'world';
  metatagIds?: string[];
};

export type TrackPool = {
  playableTracks: Track[];
  optionTracks: TrackMetadata[];
  isFallback: boolean;
};

export type MusicDiagnostics = {
  tokenConfigured: boolean;
  forceDemo: boolean;
  allowFullTrackFallback: boolean;
  themeCount: number;
  lastFallbackReason?: string;
};

const THEMES: ThemeConfig[] = [
  {
    id: 'chart-russia',
    title: 'Яндекс: чарт России',
    description: 'Популярные треки из российского чарта',
    source: 'yandex',
    chartId: 'russia'
  },
  {
    id: 'chart-world',
    title: 'Яндекс: мировой чарт',
    description: 'Популярные треки из мирового чарта',
    source: 'yandex',
    chartId: 'world'
  },
  {
    id: 'genre-pop',
    title: 'Поп',
    description: 'Готовые поп-подборки Яндекс Музыки через метатеги',
    source: 'yandex',
    metatagIds: ['pop', 'ruspop', 'russian-pop', 'foreign-pop']
  },
  {
    id: 'genre-rock',
    title: 'Рок',
    description: 'Готовые рок-подборки Яндекс Музыки через метатеги',
    source: 'yandex',
    metatagIds: ['rock', 'rusrock', 'russian-rock', 'foreign-rock']
  },
  {
    id: 'genre-rap',
    title: 'Рэп и хип-хоп',
    description: 'Готовые рэп и хип-хоп подборки Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['rap', 'hip-hop', 'rusrap', 'russian-rap']
  },
  {
    id: 'genre-electronic',
    title: 'Электроника',
    description: 'Электронные подборки и плейлисты Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['electronic', 'electronics', 'dance-electronic']
  },
  {
    id: 'genre-dance',
    title: 'Танцевальная',
    description: 'Танцевальные подборки Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['dance', 'club', 'house']
  },
  {
    id: 'genre-indie',
    title: 'Инди',
    description: 'Инди-подборки Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['indie', 'alternative', 'rusindie']
  },
  {
    id: 'genre-2000s',
    title: 'Нулевые',
    description: 'Подборки треков 2000-х из Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['2000s', '00s', 'decade-2000']
  },
  {
    id: 'genre-90s',
    title: 'Девяностые',
    description: 'Подборки треков 90-х из Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['90s', '1990s', 'decade-1990']
  },
  {
    id: 'genre-kpop',
    title: 'K-pop',
    description: 'K-pop подборки Яндекс Музыки',
    source: 'yandex',
    metatagIds: ['k-pop', 'kpop']
  },
  {
    id: 'demo-pop',
    title: 'Демо: fallback',
    description: 'Резервный набор, если API Яндекса недоступен',
    source: 'demo'
  }
];

export class MusicService {
  private readonly token = process.env.YANDEX_MUSIC_TOKEN;
  private readonly forceDemo = process.env.YANDEX_MUSIC_USE_DEMO === 'true';
  private readonly allowFullTrackFallback = process.env.YANDEX_MUSIC_ALLOW_FULL_TRACK_FALLBACK === 'true';
  private lastFallbackReason: string | undefined;

  getThemes(): Theme[] {
    return THEMES.map(({ chartId: _chartId, metatagIds: _metatagIds, ...theme }) => theme);
  }

  diagnostics(): MusicDiagnostics {
    return {
      tokenConfigured: Boolean(this.token),
      forceDemo: this.forceDemo,
      allowFullTrackFallback: this.allowFullTrackFallback,
      themeCount: THEMES.length,
      lastFallbackReason: this.lastFallbackReason
    };
  }

  async prepareTrackPool(
    themeId: string,
    options: { playableLimit: number; optionLimit: number }
  ): Promise<TrackPool> {
    if (this.forceDemo || themeId === 'demo-pop') {
      return toDemoPool(false);
    }

    try {
      const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
      const candidates = uniqueByTrackId(shuffle(await this.getThemeCandidates(theme)));
      const optionTracks = uniqueByTitle(candidates.map(toTrackMetadata)).slice(0, options.optionLimit);
      const playableTracks: Track[] = [];

      for (const candidate of candidates) {
        const audioUrl = await this.resolveAudioUrl(candidate);
        if (audioUrl) {
          playableTracks.push({
            ...toTrackMetadata(candidate),
            audioUrl
          });
        }

        if (playableTracks.length >= options.playableLimit) {
          break;
        }
      }

      if (playableTracks.length >= 4 && optionTracks.length >= 4) {
        this.lastFallbackReason = undefined;
        return {
          playableTracks,
          optionTracks,
          isFallback: false
        };
      }

      return this.fallback(`Yandex returned ${playableTracks.length} playable tracks and ${optionTracks.length} options`);
    } catch (error) {
      return this.fallback(toClientMessage(error));
    }
  }

  async getPlayableTracks(themeId: string, minimum = 8): Promise<Track[]> {
    const pool = await this.prepareTrackPool(themeId, {
      playableLimit: minimum,
      optionLimit: Math.max(32, minimum * 4)
    });
    return pool.playableTracks;
  }

  async probe(limit = 10): Promise<Array<{ id: string; title: string; hasAudio: boolean; audioUrl?: string }>> {
    const candidates = await this.getChartCandidates('russia');
    const results = [];

    for (const candidate of candidates.slice(0, limit)) {
      const audioUrl = await this.resolveAudioUrl(candidate);
      results.push({
        id: String(candidate.id),
        title: candidate.title,
        hasAudio: Boolean(audioUrl),
        audioUrl
      });
    }

    return results;
  }

  private fallback(reason: string): TrackPool {
    this.lastFallbackReason = reason;
    console.warn(`[music] using demo fallback: ${reason}`);
    return toDemoPool(true);
  }

  private async getThemeCandidates(theme: ThemeConfig): Promise<YandexTrack[]> {
    if (theme.chartId) {
      return this.getChartCandidates(theme.chartId);
    }

    if (theme.metatagIds) {
      const tracks = await this.getMetatagCandidates(theme.metatagIds);
      if (tracks.length > 0) {
        return tracks;
      }
    }

    return this.getChartCandidates('russia');
  }

  private async getChartCandidates(chartId: 'russia' | 'world'): Promise<YandexTrack[]> {
    const result = await this.get<ChartResult>(`/landing3/chart/${chartId}`);
    return (
      result.chart?.tracks
        ?.map((entry) => entry.track)
        .filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? []
    );
  }

  private async getMetatagCandidates(metatagIds: string[]): Promise<YandexTrack[]> {
    const tracks: YandexTrack[] = [];

    for (const metatagId of metatagIds) {
      tracks.push(...(await this.getMetatagTracks(metatagId)));
      if (tracks.length >= 120) {
        break;
      }
    }

    return uniqueByTrackId(tracks);
  }

  private async getMetatagTracks(metatagId: string): Promise<YandexTrack[]> {
    const tracks: YandexTrack[] = [];

    try {
      const params = new URLSearchParams({
        tracksCount: '80',
        playlistsCount: '12',
        tracksSortBy: 'popular'
      });
      const result = await this.get<MetatagResult>(`/metatags/${metatagId}?${params}`);
      tracks.push(...extractTracks(result.tracks));
      tracks.push(...(await this.getPlaylistTracks(result.playlists)));
    } catch (error) {
      console.warn(`[music] metatag ${metatagId} failed: ${toClientMessage(error)}`);
    }

    if (tracks.length >= 40) {
      return tracks;
    }

    try {
      const params = new URLSearchParams({
        offset: '0',
        limit: '16',
        sortBy: 'popular'
      });
      const result = await this.get<MetatagPlaylistsResult>(`/metatags/${metatagId}/playlists?${params}`);
      tracks.push(...(await this.getPlaylistTracks(result.playlists)));
    } catch (error) {
      console.warn(`[music] metatag playlists ${metatagId} failed: ${toClientMessage(error)}`);
    }

    return tracks;
  }

  private async getPlaylistTracks(playlists: YandexPlaylist[] | undefined): Promise<YandexTrack[]> {
    const tracks: YandexTrack[] = [];

    for (const playlist of playlists ?? []) {
      tracks.push(...extractTracks(playlist.tracks));
      if (tracks.length >= 160) {
        break;
      }

      const uid = playlist.owner?.id ?? playlist.owner?.uid ?? playlist.uid;
      const kind = playlist.kind;
      if (!uid || !kind) {
        continue;
      }

      try {
        const result = await this.get<PlaylistResult>(`/users/${uid}/playlists/${kind}`);
        const fullPlaylist: YandexPlaylist = isPlaylistEnvelope(result) ? result.playlist : (result as YandexPlaylist);
        tracks.push(...extractTracks(fullPlaylist.tracks));
      } catch (error) {
        console.warn(`[music] playlist ${uid}:${kind} failed: ${toClientMessage(error)}`);
      }
    }

    return tracks;
  }

  private async resolveAudioUrl(track: YandexTrack): Promise<string | undefined> {
    const trailerUrl = await this.tryTrailerAudioUrl(track);
    if (trailerUrl) {
      return trailerUrl;
    }

    if (!this.allowFullTrackFallback) {
      return undefined;
    }

    return this.tryDownloadInfoAudioUrl(track.id);
  }

  private async tryTrailerAudioUrl(track: YandexTrack): Promise<string | undefined> {
    try {
      const result = await this.get<TrackTrailerResult | unknown>(`/tracks/${track.id}/trailer`);
      const directUrl = findAudioUrl(result);
      if (directUrl) {
        return directUrl;
      }

      const trailerTrackId =
        result && typeof result === 'object' && 'track' in result && result.track && typeof result.track === 'object' && 'id' in result.track
          ? result.track.id
          : undefined;

      return trailerTrackId ? this.tryDownloadInfoAudioUrl(trailerTrackId as string | number) : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryDownloadInfoAudioUrl(trackId: string | number): Promise<string | undefined> {
    try {
      const infos = await this.get<DownloadInfo[]>(`/tracks/${trackId}/download-info`);
      const best = [...infos].sort((a, b) => Number(b.preview) - Number(a.preview))[0];
      if (!best) {
        return undefined;
      }
      if (best.directLink) {
        return best.directLink;
      }
      if (!best.downloadInfoUrl) {
        return undefined;
      }

      const xml = await fetchText(best.downloadInfoUrl, this.headers());
      return buildYandexDownloadUrl(xml);
    } catch {
      return undefined;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${YANDEX_API_BASE}${path}`, {
      headers: this.headers()
    });

    if (!response.ok) {
      throw new Error(`Yandex Music request failed: ${response.status}`);
    }

    const body = (await response.json()) as YandexResponse<T>;
    if (!body.result) {
      throw new Error('Yandex Music response has no result');
    }
    return body.result;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'GuessTheMelody/0.1'
    };
    if (this.token) {
      headers.Authorization = `OAuth ${this.token}`;
    }
    return headers;
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Download info XML failed: ${response.status}`);
  }
  return response.text();
}

function buildYandexDownloadUrl(xml: string): string | undefined {
  const host = readXmlTag(xml, 'host');
  const path = readXmlTag(xml, 'path');
  const timestamp = readXmlTag(xml, 'ts');
  const secret = readXmlTag(xml, 's');

  if (!host || !path || !timestamp || !secret) {
    return undefined;
  }

  const sign = createHash('md5')
    .update(`${DOWNLOAD_SIGN_SALT}${path.slice(1)}${secret}`, 'utf8')
    .digest('hex');

  return `https://${host}/get-mp3/${sign}/${timestamp}${path}`;
}

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1];
}

function findAudioUrl(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return /^https?:\/\/.+\.(mp3|m4a|aac|ogg)(\?.*)?$/i.test(value) ? value : undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  for (const item of Object.values(value)) {
    const found = findAudioUrl(item);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function extractTracks(tracks: Array<YandexTrack | YandexTrackShort> | undefined): YandexTrack[] {
  return (
    tracks
      ?.map(getEntryTrack)
      .filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? []
  );
}

function getEntryTrack(entry: YandexTrack | YandexTrackShort): YandexTrack | undefined {
  if ('id' in entry && 'title' in entry) {
    return entry;
  }
  return entry.track;
}

function isPlaylistEnvelope(value: PlaylistResult): value is { playlist: YandexPlaylist } {
  return 'playlist' in value && Boolean(value.playlist);
}

function normalizeCoverUrl(coverUri?: string): string | undefined {
  if (!coverUri) {
    return undefined;
  }
  return `https://${coverUri.replace('%%', '400x400')}`;
}

function toTrackMetadata(track: YandexTrack): TrackMetadata {
  return {
    id: String(track.id),
    title: track.title,
    artist: track.artists?.map((artist) => artist.name).join(', ') || 'Неизвестный исполнитель',
    coverUrl: normalizeCoverUrl(track.coverUri)
  };
}

function uniqueByTrackId<T extends { id: string | number }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = String(item.id);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

function uniqueByTitle<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }

  return unique;
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function toDemoPool(isFallback: boolean): TrackPool {
  return {
    playableTracks: DEMO_TRACKS,
    optionTracks: DEMO_TRACKS.map(({ audioUrl: _audioUrl, ...track }) => track),
    isFallback
  };
}

function toClientMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected Yandex Music error';
}

const DEMO_TRACKS: Track[] = [
  {
    id: 'demo-1',
    title: 'Black',
    artist: 'GAZIROVKA',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview126/v4/f5/00/5c/f5005c9e-172b-2269-1dc6-48bfa4838f04/mzaf_18065773243751878503.plus.aac.p.m4a'
  },
  {
    id: 'demo-2',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/c5/38/05/c5380566-2aca-2bea-2be8-86fd049218ad/mzaf_4579040603102711136.plus.aac.p.m4a'
  },
  {
    id: 'demo-3',
    title: 'Flowers',
    artist: 'Miley Cyrus',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview116/v4/bb/09/87/bb0987ec-9631-433b-af6d-0ac13fe00fc0/mzaf_3514135427177152231.plus.aac.p.m4a'
  },
  {
    id: 'demo-4',
    title: 'Shape of You',
    artist: 'Ed Sheeran',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview122/v4/dc/4e/71/dc4e71ec-84a5-6d2d-7b70-f880624abf0a/mzaf_4753926143281402474.plus.aac.p.m4a'
  },
  {
    id: 'demo-5',
    title: 'Bad Romance',
    artist: 'Lady Gaga',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/88/59/70/88597012-40a3-d774-8610-6e1cc3f6e9a6/mzaf_15074654609095519431.plus.aac.p.m4a'
  },
  {
    id: 'demo-6',
    title: 'Rolling in the Deep',
    artist: 'Adele',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview126/v4/f5/00/5c/f5005c9e-172b-2269-1dc6-48bfa4838f04/mzaf_18065773243751878503.plus.aac.p.m4a'
  },
  {
    id: 'demo-7',
    title: 'Levitating',
    artist: 'Dua Lipa',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview112/v4/c5/38/05/c5380566-2aca-2bea-2be8-86fd049218ad/mzaf_4579040603102711136.plus.aac.p.m4a'
  },
  {
    id: 'demo-8',
    title: 'Uptown Funk',
    artist: 'Mark Ronson',
    audioUrl:
      'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview116/v4/bb/09/87/bb0987ec-9631-433b-af6d-0ac13fe00fc0/mzaf_3514135427177152231.plus.aac.p.m4a'
  }
];

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

type AlbumResult = {
  volumes?: Array<Array<YandexTrack | YandexTrackShort>>;
};

type StationTracksResult = {
  sequence?: Array<{ track?: YandexTrack }>;
};

type SearchResult = {
  tracks?: {
    results?: YandexTrack[];
  };
};

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
  stationIds?: string[];
  optionQueries?: string[];
};

type TrackSourceInput =
  | string
  | {
      themeIds?: string[];
      playlistUrl?: string;
      playlistUrls?: string[];
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
  lastLoadStats?: TrackLoadStats;
};

type TrackLoadStats = {
  candidates: number;
  options: number;
  playable: number;
  trailerRequests: number;
  trailerDirectUrls: number;
  trailerTracks: number;
  trailerAudioUrls: number;
  fullTrackFallbacks: number;
  audioFailures: number;
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
    stationIds: ['genre:pop'],
    metatagIds: ['pop', 'ruspop', 'russian-pop', 'foreign-pop']
  },
  {
    id: 'genre-rock',
    title: 'Рок',
    description: 'Готовые рок-подборки Яндекс Музыки через метатеги',
    source: 'yandex',
    stationIds: ['genre:allrock', 'genre:rock'],
    metatagIds: ['rock', 'rusrock', 'russian-rock', 'foreign-rock']
  },
  {
    id: 'genre-rap',
    title: 'Рэп и хип-хоп',
    description: 'Готовые рэп и хип-хоп подборки Яндекс Музыки',
    source: 'yandex',
    stationIds: ['genre:rap', 'genre:hiphop'],
    metatagIds: ['rap', 'hip-hop', 'rusrap', 'russian-rap']
  },
  {
    id: 'genre-electronic',
    title: 'Электроника',
    description: 'Электронные подборки и плейлисты Яндекс Музыки',
    source: 'yandex',
    stationIds: ['genre:electronics', 'genre:electronic'],
    metatagIds: ['electronic', 'electronics', 'dance-electronic'],
    optionQueries: ['electronic music', 'edm', 'techno', 'house music']
  },
  {
    id: 'genre-dance',
    title: 'Танцевальная',
    description: 'Танцевальные подборки Яндекс Музыки',
    source: 'yandex',
    stationIds: ['genre:dance'],
    metatagIds: ['dance', 'club', 'house'],
    optionQueries: ['dance music', 'club music', 'house music']
  },
  {
    id: 'genre-indie',
    title: 'Инди',
    description: 'Инди-подборки Яндекс Музыки',
    source: 'yandex',
    stationIds: ['genre:indie'],
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
    stationIds: ['genre:kpop', 'genre:k-pop'],
    metatagIds: ['k-pop', 'kpop'],
    optionQueries: ['k-pop', 'kpop', 'korean pop']
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
  private lastLoadStats: TrackLoadStats | undefined;

  getThemes(): Theme[] {
    return THEMES.map(({ chartId: _chartId, metatagIds: _metatagIds, stationIds: _stationIds, ...theme }) => theme);
  }

  diagnostics(): MusicDiagnostics {
    return {
      tokenConfigured: Boolean(this.token),
      forceDemo: this.forceDemo,
      allowFullTrackFallback: this.allowFullTrackFallback,
      themeCount: THEMES.length,
      lastFallbackReason: this.lastFallbackReason,
      lastLoadStats: this.lastLoadStats
    };
  }

  async prepareTrackPool(source: TrackSourceInput, options: { playableLimit: number; optionLimit: number }): Promise<TrackPool> {
    const playlistUrls = typeof source === 'string' ? [] : source.playlistUrls?.length ? source.playlistUrls : source.playlistUrl ? [source.playlistUrl] : [];
    const themeIds =
      typeof source === 'string'
        ? [source]
        : source.themeIds && (source.themeIds.length > 0 || playlistUrls.length > 0)
          ? source.themeIds
          : ['chart-russia'];

    if (this.forceDemo || themeIds.includes('demo-pop')) {
      return toDemoPool(false);
    }

    try {
      const candidates = uniqueByTrackId(await this.getSourceCandidates(themeIds, playlistUrls));
      const optionTracks = uniqueByTitle(candidates.map(toTrackMetadata)).slice(0, options.optionLimit);
      const playableTracks: Track[] = [];
      const stats = createTrackLoadStats(candidates.length, optionTracks.length);

      for (const candidate of candidates) {
        const audioUrl = await this.resolveAudioUrl(candidate, stats);
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
        stats.playable = playableTracks.length;
        this.lastLoadStats = stats;
        return {
          playableTracks,
          optionTracks,
          isFallback: false
        };
      }

      stats.playable = playableTracks.length;
      this.lastLoadStats = stats;
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

    const tracks: YandexTrack[] = [];

    if (theme.stationIds) {
      tracks.push(...(await this.getStationCandidates(theme.stationIds)));
    }

    if (theme.metatagIds) {
      tracks.push(...(await this.getMetatagCandidates(theme.metatagIds)));
    }

    if (theme.optionQueries && tracks.length < 160) {
      tracks.push(...(await this.getSearchCandidates(theme.optionQueries)));
    }

    return uniqueByTrackId(tracks);
  }

  private async getSourceCandidates(themeIds: string[], playlistUrls: string[] = []): Promise<YandexTrack[]> {
    const sourceGroups: YandexTrack[][] = [];

    for (const playlistUrl of playlistUrls) {
      try {
        const tracks = await this.getPlaylistUrlCandidates(playlistUrl);
        if (tracks.length > 0) {
          sourceGroups.push(shuffle(tracks));
        }
      } catch (error) {
        console.warn(`[music] source ${playlistUrl} failed: ${toClientMessage(error)}`);
      }
    }

    for (const themeId of themeIds) {
      const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
      const tracks = await this.getThemeCandidates(theme);
      if (tracks.length > 0) {
        sourceGroups.push(shuffle(tracks));
      }
    }

    return uniqueByTrackId(interleaveSourceGroups(sourceGroups)).slice(0, 700);
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

  private async getStationCandidates(stationIds: string[]): Promise<YandexTrack[]> {
    const tracks: YandexTrack[] = [];

    for (const stationId of stationIds) {
      try {
        const result = await this.get<StationTracksResult>(
          `/rotor/station/${encodeURI(stationId)}/tracks?${new URLSearchParams({ settings2: 'true' })}`
        );
        tracks.push(
          ...(result.sequence
            ?.map((entry) => entry.track)
            .filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? [])
        );
      } catch (error) {
        console.warn(`[music] station ${stationId} failed: ${toClientMessage(error)}`);
      }

      if (tracks.length >= 80) {
        break;
      }
    }

    return uniqueByTrackId(tracks);
  }

  private async getSearchCandidates(queries: string[]): Promise<YandexTrack[]> {
    const tracks: YandexTrack[] = [];

    for (const query of queries) {
      try {
        const result = await this.get<SearchResult>(`/search?${new URLSearchParams({ text: query, type: 'track', page: '0' })}`);
        tracks.push(...(result.tracks?.results?.filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? []));
      } catch (error) {
        console.warn(`[music] search ${query} failed: ${toClientMessage(error)}`);
      }

      if (tracks.length >= 160) {
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

  private async getPlaylistUrlCandidates(playlistUrl: string): Promise<YandexTrack[]> {
    const parsed = parseYandexPlaylistUrl(playlistUrl);
    if (!parsed) {
      throw new Error('Unsupported Yandex Music playlist URL');
    }

    if (parsed.type === 'uuid') {
      const result = await this.get<PlaylistResult>(`/playlist/${parsed.uuid}`);
      const playlist: YandexPlaylist = isPlaylistEnvelope(result) ? result.playlist : (result as YandexPlaylist);
      return extractTracks(playlist.tracks).slice(0, 700);
    }

    if (parsed.type === 'album') {
      const result = await this.get<AlbumResult>(`/albums/${parsed.id}/with-tracks`);
      return extractTracks(result.volumes?.flat()).slice(0, 700);
    }

    const result = await this.get<PlaylistResult>(`/users/${parsed.uid}/playlists/${parsed.kind}`);
    const playlist: YandexPlaylist = isPlaylistEnvelope(result) ? result.playlist : (result as YandexPlaylist);
    return extractTracks(playlist.tracks).slice(0, 700);
  }

  private async resolveAudioUrl(track: YandexTrack, stats?: TrackLoadStats): Promise<string | undefined> {
    const trailerUrl = await this.tryTrailerAudioUrl(track, stats);
    if (trailerUrl) {
      return trailerUrl;
    }

    if (!this.allowFullTrackFallback) {
      if (stats) stats.audioFailures += 1;
      return undefined;
    }

    const audioUrl = await this.tryDownloadInfoAudioUrl(track.id);
    if (audioUrl) {
      if (stats) stats.fullTrackFallbacks += 1;
    } else if (stats) {
      stats.audioFailures += 1;
    }
    return audioUrl;
  }

  private async tryTrailerAudioUrl(track: YandexTrack, stats?: TrackLoadStats): Promise<string | undefined> {
    if (stats) stats.trailerRequests += 1;
    try {
      const result = await this.get<TrackTrailerResult | unknown>(`/tracks/${track.id}/trailer`);
      const directUrl = findAudioUrl(result);
      if (directUrl) {
        if (stats) stats.trailerDirectUrls += 1;
        return directUrl;
      }

      const trailerTrackId =
        result && typeof result === 'object' && 'track' in result && result.track && typeof result.track === 'object' && 'id' in result.track
          ? result.track.id
          : undefined;

      if (!trailerTrackId) {
        return undefined;
      }

      if (stats) stats.trailerTracks += 1;
      const trailerAudioUrl = await this.tryDownloadInfoAudioUrl(trailerTrackId as string | number);
      if (trailerAudioUrl && stats) stats.trailerAudioUrls += 1;
      return trailerAudioUrl;
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

type ParsedPlaylistUrl = { type: 'user'; uid: string; kind: string } | { type: 'uuid'; uuid: string } | { type: 'album'; id: string };

function parseYandexPlaylistUrl(value: string): ParsedPlaylistUrl | undefined {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const userIndex = parts.indexOf('users');
    const playlistIndex = parts.indexOf('playlists');
    const albumIndex = parts.indexOf('album');

    if (userIndex >= 0 && playlistIndex === userIndex + 2 && parts[userIndex + 1] && parts[playlistIndex + 1]) {
      return {
        type: 'user',
        uid: decodeURIComponent(parts[userIndex + 1]),
        kind: decodeURIComponent(parts[playlistIndex + 1])
      };
    }

    if (playlistIndex >= 0 && parts[playlistIndex + 1]) {
      return {
        type: 'uuid',
        uuid: decodeURIComponent(parts[playlistIndex + 1])
      };
    }

    if (albumIndex >= 0 && parts[albumIndex + 1]) {
      return {
        type: 'album',
        id: decodeURIComponent(parts[albumIndex + 1])
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
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

function interleaveSourceGroups<T>(groups: T[][]): T[] {
  const result: T[] = [];
  const queues = groups.map((group) => [...group]);
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const item = queue.shift();
      if (item) {
        result.push(item);
      }
    }
  }
  return result;
}

function createTrackLoadStats(candidates: number, options: number): TrackLoadStats {
  return {
    candidates,
    options,
    playable: 0,
    trailerRequests: 0,
    trailerDirectUrls: 0,
    trailerTracks: 0,
    trailerAudioUrls: 0,
    fullTrackFallbacks: 0,
    audioFailures: 0
  };
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

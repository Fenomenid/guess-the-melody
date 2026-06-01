import { createHash } from 'node:crypto';
import type { Theme, Track } from './types';

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

type ChartResult = {
  chart?: {
    tracks?: Array<{ track?: YandexTrack }>;
  };
};

type SearchResult = {
  tracks?: {
    results?: YandexTrack[];
  };
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
  query?: string;
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
    id: 'genre-russian-pop',
    title: 'Русский поп',
    description: 'Жанровая подборка через поиск Яндекс Музыки',
    source: 'yandex',
    query: 'русский поп'
  },
  {
    id: 'genre-rap',
    title: 'Рэп и хип-хоп',
    description: 'Русский и мировой рэп из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'рэп хип-хоп'
  },
  {
    id: 'genre-rock',
    title: 'Рок',
    description: 'Рок-треки из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'рок'
  },
  {
    id: 'genre-electronic',
    title: 'Электроника',
    description: 'Электронная музыка из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'электронная музыка'
  },
  {
    id: 'genre-dance',
    title: 'Танцевальная',
    description: 'Танцевальные треки из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'танцевальная музыка'
  },
  {
    id: 'genre-indie',
    title: 'Инди',
    description: 'Инди-треки из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'инди музыка'
  },
  {
    id: 'genre-2000s',
    title: 'Нулевые',
    description: 'Хиты 2000-х из поиска Яндекс Музыки',
    source: 'yandex',
    query: 'хиты 2000'
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

  getThemes(): Theme[] {
    return THEMES.map(({ chartId: _chartId, query: _query, ...theme }) => theme);
  }

  async getPlayableTracks(themeId: string, minimum = 8): Promise<Track[]> {
    if (this.forceDemo || themeId === 'demo-pop') {
      return DEMO_TRACKS;
    }

    try {
      const theme = THEMES.find((candidate) => candidate.id === themeId) ?? THEMES[0];
      const candidates = shuffle(await this.getThemeCandidates(theme));
      const playable: Track[] = [];

      for (const candidate of candidates) {
        const audioUrl = await this.resolveAudioUrl(candidate);
        if (audioUrl) {
          playable.push({
            id: String(candidate.id),
            title: candidate.title,
            artist: candidate.artists?.map((artist) => artist.name).join(', ') || 'Неизвестный исполнитель',
            coverUrl: normalizeCoverUrl(candidate.coverUri),
            audioUrl
          });
        }

        if (playable.length >= minimum) {
          break;
        }
      }

      return playable.length >= 4 ? playable : DEMO_TRACKS;
    } catch {
      return DEMO_TRACKS;
    }
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

  private async getThemeCandidates(theme: ThemeConfig): Promise<YandexTrack[]> {
    if (theme.query) {
      const result = await this.get<SearchResult>(`/search?${new URLSearchParams({ text: theme.query, type: 'track', page: '0' })}`);
      const tracks = result.tracks?.results?.filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? [];
      if (tracks.length > 0) {
        return tracks;
      }
    }

    try {
      return await this.getChartCandidates(theme.chartId ?? 'russia');
    } catch {
      return this.getChartCandidates('russia');
    }
  }

  private async getChartCandidates(chartId: 'russia' | 'world'): Promise<YandexTrack[]> {
    const result = await this.get<ChartResult>(`/landing3/chart/${chartId}`);
    return (
      result.chart?.tracks
        ?.map((entry) => entry.track)
        .filter((track): track is YandexTrack => Boolean(track?.id && track.title)) ?? []
    );
  }

  private async resolveAudioUrl(track: YandexTrack): Promise<string | undefined> {
    const trailerUrl = await this.tryTrailerAudioUrl(track.id);
    if (trailerUrl) {
      return trailerUrl;
    }

    return this.tryDownloadInfoAudioUrl(track.id);
  }

  private async tryTrailerAudioUrl(trackId: string | number): Promise<string | undefined> {
    try {
      const result = await this.get<unknown>(`/tracks/${trackId}/trailer`);
      return findAudioUrl(result);
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

function normalizeCoverUrl(coverUri?: string): string | undefined {
  if (!coverUri) {
    return undefined;
  }
  return `https://${coverUri.replace('%%', '400x400')}`;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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

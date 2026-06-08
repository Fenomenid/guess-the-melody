import { randomUUID } from 'node:crypto';

type Fetcher = typeof fetch;

type AudioCacheEntry = {
  id: string;
  roomCode: string;
  upstreamUrl: string;
  mimeType: string;
  body: Buffer;
};

export type CachedAudioResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

export class AudioCache {
  private readonly fetcher: Fetcher;
  private readonly maxBytes: number;
  private readonly entries = new Map<string, AudioCacheEntry>();
  private readonly idsByUpstreamUrl = new Map<string, string>();
  private readonly idsByRoom = new Map<string, Set<string>>();

  constructor({ fetcher = fetch, maxBytes = 2_000_000 }: { fetcher?: Fetcher; maxBytes?: number } = {}) {
    this.fetcher = fetcher;
    this.maxBytes = maxBytes;
  }

  async cacheTrackAudio(roomCode: string, upstreamUrl: string): Promise<string> {
    const normalizedRoomCode = roomCode.toUpperCase();
    const url = normalizeAudioUrl(upstreamUrl);
    const cacheKey = this.cacheKey(normalizedRoomCode, url);
    const existingId = this.idsByUpstreamUrl.get(cacheKey);
    if (existingId) {
      this.trackRoomEntry(normalizedRoomCode, existingId);
      return this.localUrl(existingId);
    }

    const response = await this.fetcher(url, {
      headers: {
        Accept: 'audio/*,*/*;q=0.8'
      }
    });
    if (!response.ok) {
      throw new Error(`Audio download failed: ${response.status}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0) {
      throw new Error('Audio file is empty');
    }
    if (body.length > this.maxBytes) {
      throw new Error('Audio file is too large');
    }

    const id = randomUUID();
    const entry: AudioCacheEntry = {
      id,
      roomCode: normalizedRoomCode,
      upstreamUrl: url,
      mimeType: response.headers.get('content-type') ?? 'audio/mpeg',
      body
    };
    this.entries.set(id, entry);
    this.idsByUpstreamUrl.set(cacheKey, id);
    this.trackRoomEntry(normalizedRoomCode, id);
    return this.localUrl(id);
  }

  read(id: string, rangeHeader?: string): CachedAudioResponse | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }

    const range = parseRange(rangeHeader, entry.body.length);
    if (!range) {
      return {
        status: 200,
        headers: this.headers(entry.mimeType, entry.body.length),
        body: entry.body
      };
    }

    const body = entry.body.subarray(range.start, range.end + 1);
    return {
      status: 206,
      headers: {
        ...this.headers(entry.mimeType, body.length),
        'Content-Range': `bytes ${range.start}-${range.end}/${entry.body.length}`
      },
      body
    };
  }

  clearRoom(roomCode: string): void {
    const normalizedRoomCode = roomCode.toUpperCase();
    const ids = this.idsByRoom.get(normalizedRoomCode);
    if (!ids) {
      return;
    }

    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        this.idsByUpstreamUrl.delete(this.cacheKey(normalizedRoomCode, entry.upstreamUrl));
      }
      this.entries.delete(id);
    }
    this.idsByRoom.delete(normalizedRoomCode);
  }

  private localUrl(id: string): string {
    return `/api/audio/${id}`;
  }

  private cacheKey(roomCode: string, upstreamUrl: string): string {
    return `${roomCode}:${upstreamUrl}`;
  }

  private headers(mimeType: string, contentLength: number): Record<string, string> {
    return {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': String(contentLength),
      'Content-Type': mimeType
    };
  }

  private trackRoomEntry(roomCode: string, id: string): void {
    const ids = this.idsByRoom.get(roomCode) ?? new Set<string>();
    ids.add(id);
    this.idsByRoom.set(roomCode, ids);
  }
}

function normalizeAudioUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS audio URLs are allowed');
  }
  return url.toString();
}

function parseRange(rangeHeader: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!rangeHeader) {
    return undefined;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return undefined;
  }

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) {
    return undefined;
  }

  if (!startValue) {
    const suffixLength = Number(endValue);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return undefined;
    }
    return {
      start: Math.max(0, size - suffixLength),
      end: size - 1
    };
  }

  const start = Number(startValue);
  const end = endValue ? Number(endValue) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return undefined;
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

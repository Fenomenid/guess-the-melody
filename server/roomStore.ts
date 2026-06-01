import type { SerializedRoom } from './game';

const ROOM_STATE_KEY = 'guess-the-melody:rooms';
const ROOM_TTL_SECONDS = 72 * 60 * 60;

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

export class RoomStore {
  private readonly restUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  private readonly token = process.env.UPSTASH_REDIS_REST_TOKEN;

  get enabled(): boolean {
    return Boolean(this.restUrl && this.token);
  }

  async saveRooms(rooms: SerializedRoom[]): Promise<void> {
    if (!this.enabled) {
      return;
    }
    await this.command(['SET', ROOM_STATE_KEY, JSON.stringify(rooms), 'EX', ROOM_TTL_SECONDS]);
  }

  async loadRooms(): Promise<SerializedRoom[]> {
    if (!this.enabled) {
      return [];
    }
    const result = await this.command<string | null>(['GET', ROOM_STATE_KEY]);
    if (!result) {
      return [];
    }
    return JSON.parse(result) as SerializedRoom[];
  }

  private async command<T>(command: unknown[]): Promise<T | undefined> {
    if (!this.restUrl || !this.token) {
      return undefined;
    }

    const response = await fetch(this.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(command)
    });

    if (!response.ok) {
      throw new Error(`Redis command failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as RedisResponse<T>;
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.result;
  }
}

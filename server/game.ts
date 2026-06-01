import { randomUUID } from 'node:crypto';
import type {
  Player,
  PlayerAnswerResult,
  PublicRoom,
  QuestionInternal,
  RoomSettings,
  RoomStatus,
  Track,
  TrackMetadata,
  TrackOption
} from './types';

type Room = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: Map<string, Player>;
  currentQuestion?: QuestionInternal;
  usedTrackIds: Set<string>;
  usedOptionTitles: Set<string>;
  round: number;
};

export type SerializedRoom = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: Player[];
  currentQuestion?: QuestionInternal;
  usedTrackIds: string[];
  usedOptionTitles?: string[];
  round: number;
};

type PlayerInput = {
  playerId: string;
  playerName: string;
};

const DEFAULT_SETTINGS: RoomSettings = {
  themeId: 'chart-russia',
  themeIds: ['chart-russia'],
  winCondition: 'rounds',
  rounds: 5,
  targetScore: 3000,
  questionDurationMs: 15_000
};

export class GameEngine {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly codeGenerator = createRoomCode) {}

  createRoom(input: PlayerInput): PublicRoom {
    let code = this.codeGenerator();
    while (this.rooms.has(code)) {
      code = this.codeGenerator();
    }

    const player = createPlayer(input, true);
    const room: Room = {
      code,
      status: 'lobby',
      settings: { ...DEFAULT_SETTINGS },
      players: new Map([[player.id, player]]),
      usedTrackIds: new Set(),
      usedOptionTitles: new Set(),
      round: 0
    };

    this.rooms.set(code, room);
    return toPublicRoom(room);
  }

  joinRoom(code: string, input: PlayerInput): PublicRoom {
    const room = this.requireRoom(code);
    const existing = room.players.get(input.playerId);

    if (existing) {
      existing.connected = true;
      existing.name = sanitizeName(input.playerName);
    } else {
      room.players.set(input.playerId, createPlayer(input, false));
    }

    return toPublicRoom(room);
  }

  updateSettings(code: string, settings: Partial<RoomSettings>): PublicRoom {
    const room = this.requireRoom(code);
    if (room.status !== 'lobby') {
      throw new Error('Settings can only be changed in lobby');
    }

    room.settings = {
      ...room.settings,
      ...settings,
      themeIds: sanitizeThemeIds(settings.themeIds ?? room.settings.themeIds ?? [settings.themeId ?? room.settings.themeId]),
      themeId: sanitizeThemeIds(settings.themeIds ?? room.settings.themeIds ?? [settings.themeId ?? room.settings.themeId])[0],
      playlistUrl: sanitizeOptionalUrl(settings.playlistUrl ?? room.settings.playlistUrl),
      winCondition: settings.winCondition === 'score' ? 'score' : settings.winCondition === 'rounds' ? 'rounds' : room.settings.winCondition,
      rounds: clampInteger(settings.rounds ?? room.settings.rounds, 1, 20),
      targetScore: clampInteger(settings.targetScore ?? room.settings.targetScore, 500, 20_000),
      questionDurationMs: clampInteger(settings.questionDurationMs ?? room.settings.questionDurationMs, 5_000, 30_000)
    };

    return toPublicRoom(room);
  }

  markPreparing(code: string): PublicRoom {
    const room = this.requireRoom(code);
    if (room.status !== 'lobby' && room.status !== 'round-result') {
      throw new Error('Game can only be started from lobby or round result');
    }
    room.status = 'preparing';
    return toPublicRoom(room);
  }

  startNextRound(
    code: string,
    tracks: Track[],
    optionTracksOrDuration: TrackMetadata[] | number = tracks,
    durationMsOrNow?: number,
    now = Date.now()
  ): QuestionInternal {
    const room = this.requireRoom(code);
    if (tracks.length < 4) {
      throw new Error('At least four playable tracks are required');
    }
    const optionTracks = Array.isArray(optionTracksOrDuration) ? optionTracksOrDuration : tracks;
    const durationMs = Array.isArray(optionTracksOrDuration) ? durationMsOrNow : optionTracksOrDuration;
    const startedAt = Array.isArray(optionTracksOrDuration) ? now : (durationMsOrNow ?? now);

    const available = tracks.filter((track) => !room.usedTrackIds.has(track.id));
    const correctPool = available.length > 0 ? available : tracks;
    const correctTrack = shuffle(correctPool)[0];
    const freshDistractorPool = uniqueByTitle(optionTracks).filter(
      (track) => track.id !== correctTrack.id && normalizeTitle(track.title) !== normalizeTitle(correctTrack.title)
    );
    const distractorPool =
      freshDistractorPool.filter((track) => !room.usedOptionTitles.has(normalizeTitle(track.title))).length >= 3
        ? freshDistractorPool.filter((track) => !room.usedOptionTitles.has(normalizeTitle(track.title)))
        : freshDistractorPool;
    const sameScriptDistractors = distractorPool.filter((track) => titleScriptBucket(track.title) === titleScriptBucket(correctTrack.title));
    const distractors = shuffle(sameScriptDistractors.length >= 3 ? sameScriptDistractors : distractorPool).slice(0, 3);
    const selected = [correctTrack, ...distractors];
    if (selected.length < 4) {
      throw new Error('At least four unique playable tracks are required');
    }
    const options = shuffle(
      selected.map<TrackOption>((track) => ({
        id: track.id,
        title: track.title
      }))
    );

    for (const player of room.players.values()) {
      player.lastAnswer = undefined;
    }

    room.round += 1;
    room.status = 'question';
    room.usedTrackIds.add(correctTrack.id);
    for (const track of selected) {
      room.usedOptionTitles.add(normalizeTitle(track.title));
    }
    const durationMsFinal = durationMs ?? room.settings.questionDurationMs;
    room.currentQuestion = {
      id: randomUUID(),
      round: room.round,
      audioUrl: correctTrack.audioUrl,
      coverUrl: correctTrack.coverUrl,
      options,
      durationMs: durationMsFinal,
      startedAt,
      endsAt: startedAt + durationMsFinal,
      correctOptionId: correctTrack.id,
      correctTrack,
      scoresApplied: false
    };

    return room.currentQuestion;
  }

  submitAnswer(code: string, playerId: string, optionId: string, now = Date.now()): PlayerAnswerResult {
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);
    if (!player) {
      throw new Error('Player is not in the room');
    }
    if (!room.currentQuestion || room.status !== 'question') {
      throw new Error('No active question');
    }
    if (player.lastAnswer) {
      throw new Error('Player already answered');
    }

    const responseMs = Math.max(0, now - room.currentQuestion.startedAt);
    const isCorrect = optionId === room.currentQuestion.correctOptionId;
    const points = isCorrect ? calculatePoints(responseMs, room.currentQuestion.durationMs) : 0;

    player.lastAnswer = { optionId, isCorrect, responseMs, points };
    return player.lastAnswer;
  }

  revealRound(code: string): PublicRoom {
    const room = this.requireRoom(code);
    this.applyRoundScores(room);
    room.status = isGameFinished(room) ? 'finished' : 'round-result';
    return toPublicRoom(room, true);
  }

  resetToLobby(code: string): PublicRoom {
    const room = this.requireRoom(code);
    room.status = 'lobby';
    room.round = 0;
    room.currentQuestion = undefined;
    for (const player of room.players.values()) {
      player.score = 0;
      player.lastAnswer = undefined;
    }
    return toPublicRoom(room);
  }

  leaveRoom(code: string, playerId: string): { room?: PublicRoom; deletedRoomCode?: string } {
    const room = this.requireRoom(code);
    if (!room.players.has(playerId)) {
      throw new Error('Player is not in the room');
    }

    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return { deletedRoomCode: room.code };
    }

    if (![...room.players.values()].some((player) => player.isHost)) {
      const nextHost = room.players.values().next().value as Player | undefined;
      if (nextHost) {
        nextHost.isHost = true;
      }
    }

    return { room: toPublicRoom(room, room.status === 'round-result' || room.status === 'finished') };
  }

  kickPlayer(code: string, hostPlayerId: string, targetPlayerId: string): PublicRoom {
    const room = this.requireRoom(code);
    const host = room.players.get(hostPlayerId);
    if (!host?.isHost) {
      throw new Error('Only host can kick players');
    }
    if (hostPlayerId === targetPlayerId) {
      throw new Error('Host cannot kick themselves');
    }
    if (!room.players.has(targetPlayerId)) {
      throw new Error('Player not found');
    }

    room.players.delete(targetPlayerId);
    return toPublicRoom(room, room.status === 'round-result' || room.status === 'finished');
  }

  getPublicRoom(code: string): PublicRoom {
    return toPublicRoom(this.requireRoom(code));
  }

  exportRooms(): SerializedRoom[] {
    return [...this.rooms.values()].map((room) => ({
      code: room.code,
      status: room.status,
      settings: room.settings,
      players: [...room.players.values()],
      currentQuestion: room.currentQuestion,
      usedTrackIds: [...room.usedTrackIds],
      usedOptionTitles: [...room.usedOptionTitles],
      round: room.round
    }));
  }

  importRooms(rooms: SerializedRoom[]): void {
    this.rooms.clear();
    for (const snapshot of rooms) {
      const restoredStatus = snapshot.status === 'finished' ? 'finished' : 'lobby';
      const room: Room = {
        code: snapshot.code.toUpperCase(),
        status: restoredStatus,
        settings: normalizeSettings(snapshot.settings),
        players: new Map(snapshot.players.map((player) => [player.id, { ...player, connected: false, lastAnswer: undefined }])),
        currentQuestion: restoredStatus === 'finished' ? snapshot.currentQuestion : undefined,
        usedTrackIds: new Set(snapshot.usedTrackIds),
        usedOptionTitles: new Set(snapshot.usedOptionTitles ?? []),
        round: restoredStatus === 'finished' ? snapshot.round : 0
      };
      this.ensureHost(room);
      this.rooms.set(room.code, room);
    }
  }

  private requireRoom(code: string): Room {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      throw new Error('Room not found');
    }
    return room;
  }

  private applyRoundScores(room: Room): void {
    const question = room.currentQuestion;
    if (!question || question.scoresApplied) {
      return;
    }

    for (const player of room.players.values()) {
      player.score += player.lastAnswer?.points ?? 0;
    }
    question.scoresApplied = true;
  }

  private ensureHost(room: Room): void {
    if (room.players.size === 0 || [...room.players.values()].some((player) => player.isHost)) {
      return;
    }
    const firstPlayer = room.players.values().next().value as Player | undefined;
    if (firstPlayer) {
      firstPlayer.isHost = true;
    }
  }
}

function toPublicRoom(room: Room, revealCorrectTrack = false): PublicRoom {
  const question = room.currentQuestion
    ? {
        id: room.currentQuestion.id,
        round: room.currentQuestion.round,
        audioUrl: room.currentQuestion.audioUrl,
        coverUrl: room.currentQuestion.coverUrl,
        options: room.currentQuestion.options,
        durationMs: room.currentQuestion.durationMs,
        startedAt: room.currentQuestion.startedAt,
        endsAt: room.currentQuestion.endsAt
      }
    : undefined;

  return {
    code: room.code,
    status: room.status,
    settings: room.settings,
    players: sortPublicPlayers([...room.players.values()].map((player) => toPublicPlayer(player, revealCorrectTrack)), revealCorrectTrack),
    currentQuestion: question,
    correctTrack: revealCorrectTrack ? room.currentQuestion?.correctTrack : undefined,
    round: room.round,
    serverTime: Date.now()
  };
}

function toPublicPlayer(player: Player, revealAnswer: boolean): Player {
  if (revealAnswer || !player.lastAnswer) {
    return { ...player };
  }

  return {
    ...player,
    lastAnswer: {
      optionId: player.lastAnswer.optionId,
      isCorrect: false,
      responseMs: 0,
      points: 0
    }
  };
}

function sortPublicPlayers(players: Player[], revealRound: boolean): Player[] {
  if (revealRound) {
    return players.sort((a, b) => (b.lastAnswer?.points ?? 0) - (a.lastAnswer?.points ?? 0) || b.score - a.score);
  }
  return players.sort((a, b) => b.score - a.score);
}

function isGameFinished(room: Room): boolean {
  if (room.settings.winCondition === 'score') {
    return [...room.players.values()].some((player) => player.score >= room.settings.targetScore);
  }
  return room.round >= room.settings.rounds;
}

function createPlayer(input: PlayerInput, isHost: boolean): Player {
  return {
    id: input.playerId,
    name: sanitizeName(input.playerName),
    score: 0,
    connected: true,
    isHost
  };
}

function sanitizeName(value: string): string {
  const name = value.trim().slice(0, 32);
  return name || 'Игрок';
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
}

function sanitizeThemeIds(value: string[] | undefined): string[] {
  const ids = (value ?? []).filter((themeId): themeId is string => typeof themeId === 'string' && themeId.trim().length > 0);
  return ids.length > 0 ? [...new Set(ids.map((themeId) => themeId.trim()))].slice(0, 6) : ['chart-russia'];
}

function sanitizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed.slice(0, 600) : undefined;
}

function normalizeSettings(settings: Partial<RoomSettings>): RoomSettings {
  const themeIds = sanitizeThemeIds(settings.themeIds ?? [settings.themeId ?? DEFAULT_SETTINGS.themeId]);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    themeIds,
    themeId: themeIds[0],
    playlistUrl: sanitizeOptionalUrl(settings.playlistUrl),
    winCondition: settings.winCondition === 'score' ? 'score' : 'rounds',
    rounds: clampInteger(settings.rounds ?? DEFAULT_SETTINGS.rounds, 1, 20),
    targetScore: clampInteger(settings.targetScore ?? DEFAULT_SETTINGS.targetScore, 500, 20_000),
    questionDurationMs: clampInteger(settings.questionDurationMs ?? DEFAULT_SETTINGS.questionDurationMs, 5_000, 30_000)
  };
}

function uniqueByTitle<T extends TrackMetadata>(tracks: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const track of tracks) {
    const key = normalizeTitle(track.title);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(track);
    }
  }

  return unique;
}

type TitleScriptBucket = 'cyrillic' | 'latin' | 'mixed' | 'unknown';

function titleScriptBucket(title: string): TitleScriptBucket {
  const hasCyrillic = /[А-Яа-яЁё]/.test(title);
  const hasLatin = /[A-Za-z]/.test(title);

  if (hasCyrillic && hasLatin) {
    return 'mixed';
  }
  if (hasCyrillic) {
    return 'cyrillic';
  }
  if (hasLatin) {
    return 'latin';
  }
  return 'unknown';
}

function createRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function calculatePoints(responseMs: number, durationMs: number): number {
  const speedRatio = Math.max(0, 1 - responseMs / durationMs);
  return 500 + Math.round(speedRatio * 500);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

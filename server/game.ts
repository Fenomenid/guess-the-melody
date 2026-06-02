import { randomUUID } from 'node:crypto';
import type {
  Player,
  PlayerAnswerResult,
  PlaylistSource,
  PublicPlayer,
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
  themeIds: [],
  playlistUrls: [],
  playlistSources: [],
  difficulty: 'easy',
  winCondition: 'rounds',
  rounds: 5,
  targetScore: 10_000,
  questionDurationMs: 10_000,
  allowAnswerChange: false
};
const ANSWER_CHANGE_PENALTY = 50;

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

    const playlistUpdateProvided = settings.playlistSources !== undefined || settings.playlistUrls !== undefined || settings.playlistUrl !== undefined;
    const themeUpdateProvided = settings.themeIds !== undefined || settings.themeId !== undefined;
    const playlistSources = sanitizePlaylistSources(
      settings.playlistSources ??
        (settings.playlistUrls || settings.playlistUrl !== undefined
          ? toPlaylistSources(settings.playlistUrls ?? (settings.playlistUrl !== undefined ? [settings.playlistUrl] : []))
          : room.settings.playlistSources ??
            toPlaylistSources(room.settings.playlistUrls ?? (room.settings.playlistUrl ? [room.settings.playlistUrl] : [])))
    );
    const playlistUrls = playlistSources.map((source) => source.url);
    const playlistUrl = playlistUrls[0];
    const requestedThemeIds = settings.themeIds ?? (settings.themeId ? [settings.themeId] : room.settings.themeIds ?? [room.settings.themeId]);
    const themeIds = sanitizeThemeIds(requestedThemeIds, true);

    const difficulty = settings.difficulty === 'hard' ? 'hard' : settings.difficulty === 'easy' ? 'easy' : room.settings.difficulty;

    room.settings = {
      ...room.settings,
      ...settings,
      themeIds,
      themeId: themeIds[0] ?? room.settings.themeId ?? DEFAULT_SETTINGS.themeId,
      playlistUrl,
      playlistUrls,
      playlistSources,
      difficulty,
      winCondition: settings.winCondition === 'score' ? 'score' : settings.winCondition === 'rounds' ? 'rounds' : room.settings.winCondition,
      rounds: clampInteger(settings.rounds ?? room.settings.rounds, 1, 100),
      targetScore: clampInteger(settings.targetScore ?? room.settings.targetScore, 500, 200_000),
      questionDurationMs: clampInteger(settings.questionDurationMs ?? room.settings.questionDurationMs, 5_000, maxQuestionDurationMs(difficulty)),
      allowAnswerChange: typeof settings.allowAnswerChange === 'boolean' ? settings.allowAnswerChange : room.settings.allowAnswerChange
    };

    return toPublicRoom(room);
  }

  assertHost(code: string, playerId: string): void {
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);
    if (!player?.isHost) {
      throw new Error('Only host can perform this action');
    }
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
    const correctTrack = chooseCorrectTrack(correctPool, tracks, room.usedTrackIds);
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
      sourceName: correctTrack.sourceName,
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
    if (now > room.currentQuestion.endsAt) {
      throw new Error('Answer deadline has passed');
    }
    if (player.lastAnswer && !room.settings.allowAnswerChange) {
      throw new Error('Player already answered');
    }
    if (player.lastAnswer?.optionId === optionId) {
      return player.lastAnswer;
    }

    const responseMs = Math.max(0, now - room.currentQuestion.startedAt);
    const isCorrect = optionId === room.currentQuestion.correctOptionId;
    const answerChanges = player.lastAnswer ? player.lastAnswer.answerChanges + 1 : 0;
    const penalty = answerChanges * ANSWER_CHANGE_PENALTY;
    const points = (isCorrect ? calculatePoints(responseMs, room.currentQuestion.durationMs) : 0) - penalty;

    player.lastAnswer = { optionId, isCorrect, responseMs, points, answerChanges };
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
      player.correctAnswers = 0;
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

  disconnectPlayer(code: string, playerId: string): PublicRoom | undefined {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return undefined;
    }
    const player = room.players.get(playerId);
    if (!player) {
      return toPublicRoom(room, room.status === 'round-result' || room.status === 'finished');
    }

    player.connected = false;
    if (player.isHost) {
      const nextHost = [...room.players.values()].find((candidate) => candidate.id !== playerId && candidate.connected);
      if (nextHost) {
        player.isHost = false;
        nextHost.isHost = true;
      }
    }
    return toPublicRoom(room, room.status === 'round-result' || room.status === 'finished');
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
        players: new Map(
          snapshot.players.map((player) => [
            player.id,
            { ...player, correctAnswers: player.correctAnswers ?? 0, connected: false, lastAnswer: undefined }
          ])
        ),
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
      if (player.lastAnswer?.isCorrect) {
        player.correctAnswers += 1;
      }
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
        sourceName: room.currentQuestion.sourceName,
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
    players: sortPublicPlayers([...room.players.values()].map((player) => toPublicPlayer(player, revealCorrectTrack)), room.status, revealCorrectTrack),
    currentQuestion: question,
    correctTrack: revealCorrectTrack ? room.currentQuestion?.correctTrack : undefined,
    round: room.round,
    serverTime: Date.now()
  };
}

function toPublicPlayer(player: Player, revealAnswer: boolean): PublicPlayer {
  if (revealAnswer || !player.lastAnswer) {
    return { ...player };
  }

  return {
    ...player,
    lastAnswer: { hasAnswered: true }
  };
}

function sortPublicPlayers(players: PublicPlayer[], status: RoomStatus, revealRound: boolean): PublicPlayer[] {
  if (status === 'finished') {
    return players.sort((a, b) => b.score - a.score || b.correctAnswers - a.correctAnswers || publicAnswerPoints(b) - publicAnswerPoints(a));
  }
  if (revealRound) {
    return players.sort((a, b) => publicAnswerPoints(b) - publicAnswerPoints(a) || b.score - a.score);
  }
  return players.sort((a, b) => b.score - a.score || b.correctAnswers - a.correctAnswers);
}

function publicAnswerPoints(player: PublicPlayer): number {
  return player.lastAnswer && 'points' in player.lastAnswer ? player.lastAnswer.points : 0;
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
    correctAnswers: 0,
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

function sanitizeThemeIds(value: string[] | undefined, allowEmpty = false): string[] {
  const ids = (value ?? []).filter((themeId): themeId is string => typeof themeId === 'string' && themeId.trim().length > 0);
  return ids.length > 0 ? [...new Set(ids.map((themeId) => themeId.trim()))].slice(0, 6) : allowEmpty ? [] : ['chart-russia'];
}

function sanitizeOptionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed.slice(0, 600) : undefined;
}

function sanitizePlaylistUrls(value: string[] | undefined): string[] {
  const urls = (value ?? [])
    .map((url) => sanitizeOptionalUrl(url))
    .filter((url): url is string => Boolean(url));
  return [...new Set(urls)].slice(0, 10);
}

function sanitizePlaylistSources(value: PlaylistSource[] | undefined): PlaylistSource[] {
  const result: PlaylistSource[] = [];
  const seen = new Set<string>();

  for (const source of value ?? []) {
    const url = sanitizeOptionalUrl(source.url);
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push({
      url,
      name: sanitizePlaylistSourceName(source.name, result.length, url)
    });
    if (result.length >= 10) {
      break;
    }
  }

  return result;
}

function toPlaylistSources(urls: string[] | undefined): PlaylistSource[] {
  return sanitizePlaylistUrls(urls).map((url, index) => ({
    url,
    name: defaultPlaylistSourceName(url, index)
  }));
}

function sanitizePlaylistSourceName(value: string | undefined, index: number, url: string): string {
  const name = value?.trim().replace(/\s+/g, ' ').slice(0, 48);
  return name || defaultPlaylistSourceName(url, index);
}

function defaultPlaylistSourceName(url: string, index: number): string {
  return /\/album\//i.test(url) ? `Альбом ${index + 1}` : `Плейлист ${index + 1}`;
}

function normalizeSettings(settings: Partial<RoomSettings>): RoomSettings {
  const playlistSources = sanitizePlaylistSources(
    settings.playlistSources ?? toPlaylistSources(settings.playlistUrls ?? (settings.playlistUrl ? [settings.playlistUrl] : []))
  );
  const playlistUrls = playlistSources.map((source) => source.url);
  const playlistUrl = playlistUrls[0];
  const themeIds = sanitizeThemeIds(settings.themeIds ?? [settings.themeId ?? DEFAULT_SETTINGS.themeId], playlistUrls.length > 0);
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    themeIds,
    themeId: themeIds[0] ?? settings.themeId ?? DEFAULT_SETTINGS.themeId,
    playlistUrl,
    playlistUrls,
    playlistSources,
    difficulty: settings.difficulty === 'hard' ? 'hard' : DEFAULT_SETTINGS.difficulty,
    winCondition: settings.winCondition === 'score' ? 'score' : 'rounds',
    rounds: clampInteger(settings.rounds ?? DEFAULT_SETTINGS.rounds, 1, 100),
    targetScore: clampInteger(settings.targetScore ?? DEFAULT_SETTINGS.targetScore, 500, 200_000),
    questionDurationMs: clampInteger(
      settings.questionDurationMs ?? DEFAULT_SETTINGS.questionDurationMs,
      5_000,
      maxQuestionDurationMs(settings.difficulty === 'hard' ? 'hard' : DEFAULT_SETTINGS.difficulty)
    ),
    allowAnswerChange: settings.allowAnswerChange ?? DEFAULT_SETTINGS.allowAnswerChange
  };
}

function maxQuestionDurationMs(difficulty: RoomSettings['difficulty']): number {
  return difficulty === 'easy' ? 15_000 : 30_000;
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

function chooseCorrectTrack(candidates: Track[], allTracks: Track[], usedTrackIds: Set<string>): Track {
  const sourceGroups = new Map<string, Track[]>();
  for (const track of candidates) {
    const key = trackSourceKey(track);
    if (!key) {
      continue;
    }
    sourceGroups.set(key, [...(sourceGroups.get(key) ?? []), track]);
  }

  if (sourceGroups.size < 2) {
    return shuffle(candidates)[0];
  }

  const usedBySource = new Map<string, number>();
  for (const track of allTracks) {
    const key = trackSourceKey(track);
    if (key && usedTrackIds.has(track.id)) {
      usedBySource.set(key, (usedBySource.get(key) ?? 0) + 1);
    }
  }

  const minUsed = Math.min(...[...sourceGroups.keys()].map((key) => usedBySource.get(key) ?? 0));
  const balancedGroups = [...sourceGroups.entries()]
    .filter(([key]) => (usedBySource.get(key) ?? 0) === minUsed)
    .map(([, group]) => group);
  return shuffle(shuffle(balancedGroups)[0])[0];
}

function trackSourceKey(track: TrackMetadata): string {
  return track.sourceUrl || track.sourceName || '';
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

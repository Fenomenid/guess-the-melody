import { randomUUID } from 'node:crypto';
import type {
  Achievement,
  MatchMoment,
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

type RoundHistoryEntry = {
  round: number;
  trackTitle: string;
  answers: RoundHistoryAnswer[];
};

type RoundHistoryAnswer = {
  playerId: string;
  playerName: string;
  optionId: string;
  firstOptionId: string;
  previousOptionId?: string;
  isCorrect: boolean;
  responseMs: number;
  firstResponseMs: number;
  lastResponseMs: number;
  points: number;
  answerChanges: number;
  answerEvents: PlayerAnswerResult['answerEvents'];
  wasOnCorrectAnswer: boolean;
  leftCorrectAnswer: boolean;
  changedToCorrectAnswer: boolean;
};

type ScoredAchievement = Achievement & {
  weight: number;
  createdAt?: number;
};

type ScoredMoment = MatchMoment & {
  weight: number;
};

type Room = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: Map<string, Player>;
  currentQuestion?: QuestionInternal;
  usedTrackIds: Set<string>;
  usedOptionTitles: Set<string>;
  roundHistory: RoundHistoryEntry[];
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
  roundHistory?: RoundHistoryEntry[];
  round: number;
};

type PlayerInput = {
  playerId: string;
  playerName: string;
};

type AnswerOptionKind = 'title' | 'artist';

type AnswerOptionCandidate = {
  track: TrackMetadata;
  kind: AnswerOptionKind;
};

const DEFAULT_SETTINGS: RoomSettings = {
  themeId: 'chart-russia',
  themeIds: [],
  playlistUrls: [],
  playlistSources: [],
  difficulty: 'easy',
  answerMode: 'title',
  winCondition: 'rounds',
  rounds: 5,
  targetScore: 10_000,
  questionDurationMs: 10_000,
  allowAnswerChange: false,
  autoNextRound: true,
  achievementsEnabled: true
};
const ANSWER_CHANGE_PENALTY = 50;
const MIN_CORRECT_POINTS = 100;
const MAX_WRONG_PENALTY = 150;

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
      roundHistory: [],
      round: 0
    };

    this.rooms.set(code, room);
    return toPublicRoom(room);
  }

  createDisplayRoom(): PublicRoom {
    let code = this.codeGenerator();
    while (this.rooms.has(code)) {
      code = this.codeGenerator();
    }

    const room: Room = {
      code,
      status: 'lobby',
      settings: { ...DEFAULT_SETTINGS },
      players: new Map(),
      usedTrackIds: new Set(),
      usedOptionTitles: new Set(),
      roundHistory: [],
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
      if (![...room.players.values()].some((player) => player.isHost)) {
        existing.isHost = true;
      }
    } else {
      room.players.set(input.playerId, createPlayer(input, ![...room.players.values()].some((player) => player.isHost)));
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
      answerMode: sanitizeAnswerMode(settings.answerMode, room.settings.answerMode),
      winCondition: settings.winCondition === 'score' ? 'score' : settings.winCondition === 'rounds' ? 'rounds' : room.settings.winCondition,
      rounds: clampInteger(settings.rounds ?? room.settings.rounds, 1, 100),
      targetScore: clampInteger(settings.targetScore ?? room.settings.targetScore, 500, 200_000),
      questionDurationMs: clampInteger(settings.questionDurationMs ?? room.settings.questionDurationMs, 5_000, maxQuestionDurationMs(difficulty)),
      allowAnswerChange: typeof settings.allowAnswerChange === 'boolean' ? settings.allowAnswerChange : room.settings.allowAnswerChange,
      autoNextRound: typeof settings.autoNextRound === 'boolean' ? settings.autoNextRound : room.settings.autoNextRound,
      achievementsEnabled: true
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

  setAutoNextRound(code: string, enabled: boolean): PublicRoom {
    const room = this.requireRoom(code);
    if (room.status === 'finished') {
      throw new Error('Auto round start cannot be changed after game is finished');
    }
    room.settings.autoNextRound = enabled;
    return toPublicRoom(room, room.status === 'round-result');
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
    const answerMode = room.settings.answerMode;
    const selected = buildAnswerOptionCandidates(correctTrack, optionTracks, answerMode, room.round + 1, room.usedOptionTitles);
    if (selected.length < 4) {
      throw new Error('At least four unique playable tracks are required');
    }
    const options = shuffle(
      selected.map<TrackOption>(({ track, kind }) => ({
        id: track.id,
        title: answerOptionLabel(track, kind)
      }))
    );

    for (const player of room.players.values()) {
      player.lastAnswer = undefined;
    }

    room.round += 1;
    room.status = 'question';
    room.usedTrackIds.add(correctTrack.id);
    for (const { track, kind } of selected) {
      room.usedOptionTitles.add(normalizeTitle(answerOptionLabel(track, kind)));
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
    const previousAnswer = player.lastAnswer;
    const answerChanges = previousAnswer ? previousAnswer.answerChanges + 1 : 0;
    const penalty = answerChanges * ANSWER_CHANGE_PENALTY;
    const points = isCorrect
      ? Math.max(MIN_CORRECT_POINTS, calculatePoints(responseMs, room.currentQuestion.durationMs) - penalty)
      : -Math.min(MAX_WRONG_PENALTY, penalty);
    const answerEvents = [...(previousAnswer?.answerEvents ?? []), { optionId, responseMs }];

    player.lastAnswer = {
      optionId,
      firstOptionId: previousAnswer?.firstOptionId ?? optionId,
      previousOptionId: previousAnswer?.optionId,
      isCorrect,
      responseMs,
      firstResponseMs: previousAnswer?.firstResponseMs ?? responseMs,
      lastResponseMs: responseMs,
      points,
      answerChanges,
      answerEvents
    };
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
    room.roundHistory = [];
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
      roundHistory: room.roundHistory,
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
        roundHistory: snapshot.roundHistory ?? [],
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
    if (room.settings.achievementsEnabled) {
      room.roundHistory.push(createRoundHistoryEntry(room, question));
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
    achievements: room.settings.achievementsEnabled ? buildAchievements(room, revealCorrectTrack) : [],
    matchMoments: room.settings.achievementsEnabled && room.status === 'finished' ? buildMatchMoments(room.roundHistory) : [],
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
    lastAnswer: {
      hasAnswered: true,
      responseMs: player.lastAnswer.responseMs,
      firstResponseMs: player.lastAnswer.firstResponseMs,
      lastResponseMs: player.lastAnswer.lastResponseMs,
      answerChanges: player.lastAnswer.answerChanges
    }
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

function buildAchievements(room: Room, revealRound: boolean): Achievement[] {
  if (!room.currentQuestion) {
    return [];
  }
  return revealRound ? buildRevealAchievements(room) : buildLiveAchievements(room);
}

function buildLiveAchievements(room: Room): Achievement[] {
  const question = room.currentQuestion;
  if (!question || room.status !== 'question') {
    return [];
  }

  const answers = [...room.players.values()]
    .filter((player): player is Player & { lastAnswer: PlayerAnswerResult } => Boolean(player.lastAnswer))
    .sort((a, b) => a.lastAnswer.responseMs - b.lastAnswer.responseMs);
  const achievements: ScoredAchievement[] = [];
  const first = answers[0];
  const second = answers[1];

  if (first) {
    achievements.push({
      id: `live-first-${question.id}-${first.id}`,
      icon: '⚡',
      title: 'Первый на кнопке',
      description: pickVariant(`live-first-${question.id}-${first.id}`, [
        `${first.name} уже ткнул вариант. Уверенность или паника?`,
        `${first.name} нажал первым. Остальные еще слушают заставку.`,
        `${first.name} решил не тратить жизнь на размышления.`
      ]),
      recipient: first.name,
      tone: 'safe',
      weight: 62,
      createdAt: first.lastAnswer.responseMs
    });
  }

  if (second) {
    const closeToFirst = first ? second.lastAnswer.responseMs - first.lastAnswer.responseMs <= 500 : false;
    achievements.push({
      id: `live-second-${question.id}-${second.id}`,
      icon: '⚡',
      title: closeToFirst ? 'Почти киберспорт' : 'Серебряный тык',
      description: closeToFirst
        ? pickVariant(`live-second-close-${question.id}-${second.id}`, [
            `${second.name} дышит в спину лидеру. Неприятно близко.`,
            `${second.name} нажал почти одновременно. Судьи напряглись.`,
            `${second.name} проиграл старт на какие-то крошки времени.`
          ])
        : pickVariant(`live-second-${question.id}-${second.id}`, [
            `${second.name} пришел вторым. Быстро, но без обложки журнала.`,
            `${second.name} почти украл момент, но палец был не самый ранний.`,
            `${second.name} занял очередь сразу за главным нервным.`
          ]),
      recipient: second.name,
      tone: 'safe',
      weight: closeToFirst ? 64 : 52,
      createdAt: second.lastAnswer.responseMs
    });
  }

  for (const player of answers) {
    achievements.push(...buildAnswerChangeChain(question.id, player));
  }

  const late = answers.find((player) => player.lastAnswer.responseMs >= question.durationMs - 2_000);
  if (late) {
    achievements.push({
      id: `live-late-${question.id}-${late.id}`,
      icon: '⏱',
      title: 'На последней секунде',
      description: pickVariant(`live-late-${question.id}-${late.id}`, [
        `${late.name} нажал так поздно, что таймер уже попрощался.`,
        `${late.name} думал как взрослый. Или просто завис.`,
        `${late.name} ворвался в раунд на закрывающихся дверях.`
      ]),
      recipient: late.name,
      tone: 'safe',
      weight: 58,
      createdAt: late.lastAnswer.responseMs
    });
  }

  if (answers.length === room.players.size && room.players.size > 1) {
    achievements.push({
      id: `live-all-${question.id}`,
      icon: '✓',
      title: 'Все в деле',
      description: pickVariant(`live-all-${question.id}`, [
        'Все ответили. Теперь узнаем, кто зря был таким уверенным.',
        'Кнопки нажаты, репутации поставлены на кон.',
        'Все в деле. Музыка молчит, статистика готовит нож.'
      ]),
      recipient: 'Все игроки',
      tone: 'safe',
      weight: 50,
      createdAt: Math.max(...answers.map((player) => player.lastAnswer.responseMs))
    });
  }

  const distribution = optionDistribution(answers);
  const topOption = distribution[0];
  const secondOption = distribution[1];
  if (topOption && room.players.size >= 3 && topOption.count >= Math.max(3, Math.ceil(answers.length * 0.6))) {
    achievements.push({
      id: `live-majority-${question.id}-${topOption.optionId}`,
      icon: '👥',
      title: 'Единое мнение',
      description: pickVariant(`live-majority-${question.id}-${topOption.optionId}`, [
        'Толпа собралась вокруг одного варианта. История учит ничему.',
        'Большинство решило одинаково. Смело, опасно, коллективно.',
        'Командный разум включился. Качество разума пока неизвестно.'
      ]),
      recipient: 'Большинство',
      tone: 'chaos',
      weight: 56,
      createdAt: Math.max(...answers.filter((player) => player.lastAnswer.optionId === topOption.optionId).map((player) => player.lastAnswer.responseMs))
    });
  }
  if (topOption && secondOption && answers.length >= 4 && topOption.count - secondOption.count <= 1 && topOption.count + secondOption.count >= answers.length * 0.75) {
    achievements.push({
      id: `live-split-${question.id}`,
      icon: '⚔',
      title: 'Раскол общества',
      description: pickVariant(`live-split-${question.id}`, [
        'Комната раскололась. Осталось понять, какая половина позорится.',
        'Два лагеря, одна песня, ноль гарантий.',
        'Игроки устроили гражданскую войну на кнопках.'
      ]),
      recipient: 'Комната',
      tone: 'chaos',
      weight: 54,
      createdAt: Math.max(...answers.map((player) => player.lastAnswer.responseMs))
    });
  }

  return selectAchievements(achievements, 8);
}

function buildRevealAchievements(room: Room): Achievement[] {
  const answers = [...room.players.values()].filter((player): player is Player & { lastAnswer: PlayerAnswerResult } => Boolean(player.lastAnswer));
  const correct = answers.filter((player) => player.lastAnswer.isCorrect);
  const achievements: ScoredAchievement[] = [];
  const round = room.currentQuestion?.round ?? room.round;

  if (correct.length === 0) {
    achievements.push({
      id: `reveal-empty-${round}`,
      icon: '💀',
      title: 'Коллективный промах',
      description: pickVariant(`reveal-empty-${round}`, [
        'Никто не угадал. Трек победил людей.',
        'Комната проиграла музыке всухую.',
        'Все мимо. Зато единство коллектива на месте.'
      ]),
      recipient: 'Никто',
      tone: 'bad',
      weight: 72
    });
  }

  if (correct.length === 1 && answers.length > 1) {
    achievements.push({
      id: `reveal-only-${round}-${correct[0].id}`,
      icon: '🎯',
      title: 'Один в поле угадал',
      description: pickVariant(`reveal-only-${round}-${correct[0].id}`, [
        `${correct[0].name} вытащил раунд, пока остальные слушали другой плейлист.`,
        `${correct[0].name} единственный понял, что вообще происходит.`,
        `${correct[0].name} спас честь комнаты. Комната не помогала.`
      ]),
      recipient: correct[0].name,
      tone: 'good',
      weight: 76
    });
  }

  const fastest = correct.sort((a, b) => a.lastAnswer.responseMs - b.lastAnswer.responseMs)[0];
  if (fastest) {
    achievements.push({
      id: `reveal-fast-${round}-${fastest.id}`,
      icon: '⚡',
      title: fastest.lastAnswer.responseMs <= 1_000 ? 'Это вообще законно?' : 'Узнал с пол-ноты',
      description: fastest.lastAnswer.responseMs <= 1_000
        ? pickVariant(`reveal-fast-extreme-${round}-${fastest.id}`, [
            `${fastest.name} угадал за ${formatSeconds(fastest.lastAnswer.responseMs)} сек. Трек, похоже, начался у него раньше.`,
            `${fastest.name} нажал быстрее, чем остальные поняли, что идет игра.`,
            `${fastest.name} подключился напрямую к плейлисту.`
          ])
        : `${fastest.name}: ${formatSeconds(fastest.lastAnswer.responseMs)} сек до правильного ответа.`,
      recipient: fastest.name,
      tone: 'good',
      weight: fastest.lastAnswer.responseMs <= 1_000 ? 88 : 62
    });
  }

  const leftCorrect = answers.find((player) => player.lastAnswer.answerEvents.some((event) => event.optionId === room.currentQuestion?.correctOptionId) && !player.lastAnswer.isCorrect);
  if (leftCorrect) {
    achievements.push({
      id: `reveal-left-correct-${round}-${leftCorrect.id}`,
      icon: '🤡',
      title: 'Я так и хотел',
      description: pickVariant(`reveal-left-correct-${round}-${leftCorrect.id}`, [
        `${leftCorrect.name} нашел правильный ответ и бережно его отпустил.`,
        `${leftCorrect.name} был прав, но решил не давить интеллектом.`,
        `${leftCorrect.name} передумал ровно там, где надо было не думать.`
      ]),
      recipient: leftCorrect.name,
      tone: 'bad',
      weight: 92
    });
  }

  const fastWrong = answers.filter((player) => !player.lastAnswer.isCorrect && player.lastAnswer.firstResponseMs <= 1_500).sort((a, b) => a.lastAnswer.firstResponseMs - b.lastAnswer.firstResponseMs)[0];
  if (fastWrong) {
    achievements.push({
      id: `reveal-fast-wrong-${round}-${fastWrong.id}`,
      icon: '💀',
      title: 'Уши декоративные',
      description: pickVariant(`reveal-fast-wrong-${round}-${fastWrong.id}`, [
        `${fastWrong.name} ошибся быстрее, чем трек успел объясниться.`,
        `${fastWrong.name} нажал мгновенно. Музыка была против.`,
        `${fastWrong.name} услышал что-то свое и сразу поверил.`
      ]),
      recipient: fastWrong.name,
      tone: 'bad',
      weight: 82
    });
  }

  const steadyWrong = answers.find((player) => !player.lastAnswer.isCorrect && player.lastAnswer.answerChanges === 0);
  if (steadyWrong) {
    achievements.push({
      id: `reveal-steady-wrong-${round}-${steadyWrong.id}`,
      icon: '🗿',
      title: 'План надежный',
      description: pickVariant(`reveal-steady-wrong-${round}-${steadyWrong.id}`, [
        `${steadyWrong.name} выбрал один вариант и уверенно ушел не туда.`,
        `${steadyWrong.name} не переобувался. Просто стабильно ошибся.`,
        `${steadyWrong.name} доверился первому ответу. Ответ доверие не оценил.`
      ]),
      recipient: steadyWrong.name,
      tone: 'bad',
      weight: 74
    });
  }

  const changedCorrect = correct.find((player) => player.lastAnswer.answerChanges > 0);
  if (changedCorrect) {
    achievements.push({
      id: `reveal-change-good-${round}-${changedCorrect.id}`,
      icon: changedCorrect.lastAnswer.answerChanges >= 2 ? '🎰' : '🧠',
      title: changedCorrect.lastAnswer.answerChanges >= 2 ? 'Да ладно нахрен' : 'Переобулся удачно',
      description: changedCorrect.lastAnswer.answerChanges >= 2
        ? pickVariant(`reveal-change-good-many-${round}-${changedCorrect.id}`, [
            `${changedCorrect.name} сменил ответ ${changedCorrect.lastAnswer.answerChanges} раз и каким-то образом попал.`,
            `${changedCorrect.name} устроил хаос на кнопках, и хаос ответил взаимностью.`,
            `${changedCorrect.name} доказал, что стратегия для слабых.`
          ])
        : `${changedCorrect.name} сменил ответ и всё-таки попал. Мозг загрузился не сразу.`,
      recipient: changedCorrect.name,
      tone: 'good',
      weight: changedCorrect.lastAnswer.answerChanges >= 2 ? 84 : 66
    });
  }

  const lastSecondCorrect = correct.find((player) => player.lastAnswer.answerChanges > 0 && player.lastAnswer.lastResponseMs >= (room.currentQuestion?.durationMs ?? 0) - 2_000);
  if (lastSecondCorrect) {
    achievements.push({
      id: `reveal-last-second-correct-${round}-${lastSecondCorrect.id}`,
      icon: '🧠',
      title: 'Последняя рабочая извилина',
      description: pickVariant(`reveal-last-second-correct-${round}-${lastSecondCorrect.id}`, [
        `${lastSecondCorrect.name} включил мозг на последнем гарантийном дыхании.`,
        `${lastSecondCorrect.name} передумал в последний момент и спас лицо.`,
        `${lastSecondCorrect.name} почти проиграл таймеру, но успел украсть правильный ответ.`
      ]),
      recipient: lastSecondCorrect.name,
      tone: 'good',
      weight: 90
    });
  }

  const biggestPenalty = answers
    .filter((player) => player.lastAnswer.answerChanges > 0)
    .sort((a, b) => b.lastAnswer.answerChanges - a.lastAnswer.answerChanges)[0];
  if (biggestPenalty) {
    achievements.push({
      id: `reveal-change-chaos-${round}-${biggestPenalty.id}`,
      icon: '🔁',
      title: 'Руки быстрее мозга',
      description: pickVariant(`reveal-change-chaos-${round}-${biggestPenalty.id}`, [
        `${biggestPenalty.name} сменил ответ ${biggestPenalty.lastAnswer.answerChanges} раз. Интерфейс выдержал, счет нет.`,
        `${biggestPenalty.name} нажимал много, думал мало, получил честно.`,
        `${biggestPenalty.name} устроил шоу на кнопках и сам же купил билет.`
      ]),
      recipient: biggestPenalty.name,
      tone: biggestPenalty.lastAnswer.points < 0 ? 'bad' : 'chaos',
      weight: biggestPenalty.lastAnswer.points < 0 ? 80 : 68
    });
  }

  return selectAchievements(achievements, 5);
}

function createRoundHistoryEntry(room: Room, question: QuestionInternal): RoundHistoryEntry {
  return {
    round: question.round,
    trackTitle: question.correctTrack.title,
    answers: [...room.players.values()]
      .filter((player): player is Player & { lastAnswer: PlayerAnswerResult } => Boolean(player.lastAnswer))
      .map((player) => ({
        playerId: player.id,
        playerName: player.name,
        optionId: player.lastAnswer.optionId,
        firstOptionId: player.lastAnswer.firstOptionId,
        previousOptionId: player.lastAnswer.previousOptionId,
        isCorrect: player.lastAnswer.isCorrect,
        responseMs: player.lastAnswer.responseMs,
        firstResponseMs: player.lastAnswer.firstResponseMs,
        lastResponseMs: player.lastAnswer.lastResponseMs,
        points: player.lastAnswer.points,
        answerChanges: player.lastAnswer.answerChanges,
        answerEvents: player.lastAnswer.answerEvents,
        wasOnCorrectAnswer: player.lastAnswer.answerEvents.some((event) => event.optionId === question.correctOptionId),
        leftCorrectAnswer: player.lastAnswer.answerEvents.some((event) => event.optionId === question.correctOptionId) && !player.lastAnswer.isCorrect,
        changedToCorrectAnswer: player.lastAnswer.firstOptionId !== question.correctOptionId && player.lastAnswer.isCorrect
      }))
  };
}

function buildMatchMoments(history: RoundHistoryEntry[]): MatchMoment[] {
  const candidates: ScoredMoment[] = [];
  const allAnswers = history.flatMap((round) => round.answers.map((answer) => ({ ...answer, round: round.round, trackTitle: round.trackTitle })));
  const playerIds = new Set(allAnswers.map((answer) => answer.playerId));
  const limit = finalMomentLimit(playerIds.size);
  const correct = allAnswers.filter((answer) => answer.isCorrect);
  const fastest = [...correct].sort((a, b) => a.responseMs - b.responseMs)[0];
  const best = [...allAnswers].sort((a, b) => b.points - a.points)[0];
  const penalty = [...allAnswers].filter((answer) => answer.answerChanges > 0).sort((a, b) => a.points - b.points)[0];
  const mostChanges = [...allAnswers].filter((answer) => answer.answerChanges > 0).sort((a, b) => b.answerChanges - a.answerChanges)[0];
  const onlyCorrectRound = history.find((round) => round.answers.filter((answer) => answer.isCorrect).length === 1 && round.answers.length > 1);
  const noCorrectRound = history.find((round) => round.answers.length > 0 && round.answers.every((answer) => !answer.isCorrect));
  const playerStats = buildPlayerStats(allAnswers, history.length);
  const winner = [...playerStats].sort((a, b) => b.totalPoints - a.totalPoints || b.correct - a.correct)[0];
  const loser = [...playerStats].sort((a, b) => a.totalPoints - b.totalPoints || a.correct - b.correct)[0];
  const bestAccuracy = [...playerStats].filter((player) => player.rounds > 0 && player.correct / player.rounds >= 0.8).sort((a, b) => b.correct / b.rounds - a.correct / a.rounds)[0];
  const zeroCorrect = [...playerStats].filter((player) => player.correct === 0 && player.rounds > 0).sort((a, b) => a.totalPoints - b.totalPoints)[0];
  const npc = [...playerStats].filter((player) => player.majorityPicks >= Math.max(2, Math.ceil(player.rounds * 0.6))).sort((a, b) => b.majorityPicks - a.majorityPicks)[0];
  const suspicious = longestFastCorrectStreak(allAnswers);
  const confidentWrong = longestFastWrongStreak(allAnswers);
  const lastRound = history.at(-1);
  const lateWinner = winner && lastRound?.answers.some((answer) => answer.playerId === winner.playerId && answer.points > 0) && history.length > 1 ? winner : undefined;

  if (winner) {
    const leaderGap = winner.totalPoints - ([...playerStats].sort((a, b) => b.totalPoints - a.totalPoints)[1]?.totalPoints ?? winner.totalPoints);
    candidates.push({
      id: `moment-winner-${winner.playerId}`,
      round: history.length,
      icon: '🏆',
      title: leaderGap >= 1_500 ? 'Потный ублюдок' : 'Невыносимый тип',
      description:
        leaderGap >= 1_500
          ? pickVariant(`moment-sweaty-${winner.playerId}`, [
              `${winner.playerName} выиграл с таким отрывом, что это уже не игра, а допрос.`,
              `${winner.playerName} пришел не веселиться, а закрывать статистику.`,
              `${winner.playerName} оставил остальным только моральную победу.`
            ])
          : pickVariant(`moment-winner-${winner.playerId}`, [
              `${winner.playerName} выиграл матч. Противно, но заслуженно.`,
              `${winner.playerName} забрал первое место и остатки уважения.`,
              `${winner.playerName} пришел портить вечер и справился.`
            ]),
      recipient: winner.playerName,
      tone: 'good',
      weight: leaderGap >= 1_500 ? 100 : 78
    });
  }
  if (fastest) {
    candidates.push({
      id: `moment-fast-${fastest.round}-${fastest.playerId}`,
      round: fastest.round,
      icon: '🚨',
      title: 'Подозрительный тип',
      description: pickVariant(`moment-fast-${fastest.round}-${fastest.playerId}`, [
        `${fastest.playerName} слишком часто угадывал слишком быстро. Мы просто наблюдаем.`,
        `${fastest.playerName} играет так, будто видел плейлист до матча.`,
        `${fastest.playerName} нажимал быстро и правильно. Неприятное сочетание.`
      ]),
      recipient: fastest.playerName,
      tone: 'good',
      weight: suspicious && suspicious.playerId === fastest.playerId ? 92 : 70
    });
  }
  if (best) {
    candidates.push({
      id: `moment-best-${best.round}-${best.playerId}`,
      round: best.round,
      icon: '🏆',
      title: 'Лучший удар раунда',
      description: `${best.playerName} забрал ${formatSignedScore(best.points)} на "${best.trackTitle}".`,
      recipient: best.playerName,
      tone: best.points > 0 ? 'good' : 'bad',
      weight: 58
    });
  }
  if (onlyCorrectRound) {
    const answer = onlyCorrectRound.answers.find((item) => item.isCorrect)!;
    candidates.push({
      id: `moment-only-${onlyCorrectRound.round}-${answer.playerId}`,
      round: onlyCorrectRound.round,
      icon: '🎯',
      title: 'Один против всех',
      description: `${answer.playerName} единственный понял, что играет "${onlyCorrectRound.trackTitle}".`,
      recipient: answer.playerName,
      tone: 'good',
      weight: 76
    });
  }
  if (penalty) {
    candidates.push({
      id: `moment-penalty-${penalty.round}-${penalty.playerId}`,
      round: penalty.round,
      icon: '🦧',
      title: 'Консилиум не помог',
      description: pickVariant(`moment-penalty-${penalty.round}-${penalty.playerId}`, [
        `${penalty.playerName} перепробовал все подходы и все равно приехал вниз.`,
        `${penalty.playerName} устроил мозговой штурм одного человека. Пострадал счет.`,
        `${penalty.playerName} нажимал за троих, попадал за никого.`
      ]),
      recipient: penalty.playerName,
      tone: 'bad',
      weight: 96
    });
  }
  if (mostChanges) {
    candidates.push({
      id: `moment-change-${mostChanges.round}-${mostChanges.playerId}`,
      round: mostChanges.round,
      icon: '🔄',
      title: 'Переобувается на лету',
      description: pickVariant(`moment-change-${mostChanges.round}-${mostChanges.playerId}`, [
        `${mostChanges.playerName} сменил больше всех ответов. Принципов нет, статистика есть.`,
        `${mostChanges.playerName} переобувался так часто, что лобби стало гардеробом.`,
        `${mostChanges.playerName} не выбирал ответы, он проводил кастинг.`
      ]),
      recipient: mostChanges.playerName,
      tone: 'chaos',
      weight: 72
    });
  }
  if (noCorrectRound) {
    candidates.push({
      id: `moment-empty-${noCorrectRound.round}`,
      round: noCorrectRound.round,
      icon: '💀',
      title: 'Раунд без свидетелей',
      description: `"${noCorrectRound.trackTitle}" не угадал никто. Даже трек удивился.`,
      recipient: 'Никто',
      tone: 'bad',
      weight: 72
    });
  }
  if (loser && playerStats.length > 1) {
    candidates.push({
      id: `moment-loser-${loser.playerId}`,
      round: history.length,
      icon: '🚪',
      title: 'Можешь идти',
      description: pickVariant(`moment-loser-${loser.playerId}`, [
        `${loser.playerName} занял последнее место. Дверь не закрыта.`,
        `${loser.playerName} завершил матч так, будто играл без звука.`,
        `${loser.playerName} показал, что участие действительно главное.`
      ]),
      recipient: loser.playerName,
      tone: 'bad',
      weight: 78
    });
  }
  if (zeroCorrect) {
    candidates.push({
      id: `moment-zero-${zeroCorrect.playerId}`,
      round: history.length,
      icon: '💀',
      title: 'Братан, ты как тут оказался',
      description: pickVariant(`moment-zero-${zeroCorrect.playerId}`, [
        `${zeroCorrect.playerName} не угадал ни разу. Зато был рядом.`,
        `${zeroCorrect.playerName} прошел матч без контакта с реальностью.`,
        `${zeroCorrect.playerName} доказал, что музыка бывает фоном.`
      ]),
      recipient: zeroCorrect.playerName,
      tone: 'bad',
      weight: 98
    });
  }
  if (bestAccuracy) {
    candidates.push({
      id: `moment-accuracy-${bestAccuracy.playerId}`,
      round: history.length,
      icon: '🤓',
      title: 'Слишком много свободного времени',
      description: pickVariant(`moment-accuracy-${bestAccuracy.playerId}`, [
        `${bestAccuracy.playerName} слишком часто угадывал. Это уже биография, а не игра.`,
        `${bestAccuracy.playerName} знает подозрительно много треков. Вопросы есть.`,
        `${bestAccuracy.playerName} слушал музыку вместо нормальной жизни.`
      ]),
      recipient: bestAccuracy.playerName,
      tone: 'good',
      weight: 82
    });
  }
  if (npc) {
    candidates.push({
      id: `moment-npc-${npc.playerId}`,
      round: history.length,
      icon: '🐑',
      title: 'NPC',
      description: pickVariant(`moment-npc-${npc.playerId}`, [
        `${npc.playerName} шел за толпой так уверенно, будто там квестовая метка.`,
        `${npc.playerName} выбирал вместе с большинством. Индивидуальность отложена.`,
        `${npc.playerName} доверял коллективному разуму. Смелый эксперимент.`
      ]),
      recipient: npc.playerName,
      tone: 'chaos',
      weight: 74
    });
  }
  if (confidentWrong) {
    candidates.push({
      id: `moment-confident-wrong-${confidentWrong.playerId}`,
      round: confidentWrong.round,
      icon: '🗣',
      title: 'Главное уверенность',
      description: pickVariant(`moment-confident-wrong-${confidentWrong.playerId}`, [
        `${confidentWrong.playerName} ошибался быстро и с характером.`,
        `${confidentWrong.playerName} уверенно нажимал не туда несколько раундов подряд.`,
        `${confidentWrong.playerName} доказал, что скорость без смысла тоже скорость.`
      ]),
      recipient: confidentWrong.playerName,
      tone: 'bad',
      weight: 84
    });
  }
  if (lateWinner) {
    candidates.push({
      id: `moment-steal-${lateWinner.playerId}`,
      round: history.length,
      icon: '💸',
      title: 'Украл катку',
      description: pickVariant(`moment-steal-${lateWinner.playerId}`, [
        `${lateWinner.playerName} забрал первое место в последнем раунде. Воровство оформлено.`,
        `${lateWinner.playerName} подождал весь матч и украл финальную табличку.`,
        `${lateWinner.playerName} сделал камбэк, после которого хочется пересчитать очки.`
      ]),
      recipient: lateWinner.playerName,
      tone: 'chaos',
      weight: 90
    });
  }

  return selectMoments(candidates, limit);
}

function buildAnswerChangeChain(questionId: string, player: Player & { lastAnswer: PlayerAnswerResult }): ScoredAchievement[] {
  const chainId = `${questionId}-answer-changes-${player.id}`;
  const steps = [
    {
      threshold: 1,
      title: 'Переобулся в воздухе',
      description: [
        `${player.name} сменил ответ. Минус очки, плюс драма.`,
        `${player.name} передумал. Пока без паники, но мы записали.`,
        `${player.name} аккуратно начал карьеру переобувателя.`
      ],
      weight: 60
    },
    {
      threshold: 2,
      title: 'Куда жмем, командир?',
      description: [
        `${player.name} сменил ответ второй раз. План становится объемным.`,
        `${player.name} уже не выбирает, а ведет переговоры с кнопками.`,
        `${player.name} попробовал еще один вариант. Вдруг музыка оценит.`
      ],
      weight: 70
    },
    {
      threshold: 3,
      title: 'Паническая закупка',
      description: [
        `${player.name} скупает варианты, пока таймер терпит.`,
        `${player.name} устроил распродажу уверенности.`,
        `${player.name} нажимает так, будто один из вариантов сдастся.`
      ],
      weight: 80
    },
    {
      threshold: 5,
      title: 'Руки живут отдельно',
      description: [
        `${player.name} больше не управляет процессом. Процесс управляет им.`,
        `${player.name} довел интерфейс до собеседования в психотерапию.`,
        `${player.name} нажал уже достаточно, чтобы игра запомнила лицо.`
      ],
      weight: 92
    }
  ];

  return steps
    .filter((step) => player.lastAnswer.answerChanges >= step.threshold)
    .map((step, index) => ({
      id: `live-change-${questionId}-${player.id}-${step.threshold}`,
      icon: '↔',
      title: step.title,
      description: pickVariant(`live-change-${questionId}-${player.id}-${step.threshold}`, step.description),
      recipient: player.name,
      tone: 'chaos',
      chainId,
      chainStep: index + 1,
      chainTotal: steps.length,
      weight: step.weight,
      createdAt: player.lastAnswer.answerEvents[Math.min(step.threshold, player.lastAnswer.answerEvents.length - 1)]?.responseMs ?? player.lastAnswer.responseMs
    }));
}

function optionDistribution(answers: Array<Player & { lastAnswer: PlayerAnswerResult }>): Array<{ optionId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const player of answers) {
    counts.set(player.lastAnswer.optionId, (counts.get(player.lastAnswer.optionId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([optionId, count]) => ({ optionId, count })).sort((a, b) => b.count - a.count);
}

function selectAchievements(achievements: ScoredAchievement[], limit: number): Achievement[] {
  return uniqueAchievements(achievements)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.weight - a.weight)
    .slice(0, limit)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(({ weight: _weight, createdAt: _createdAt, ...achievement }) => achievement);
}

function selectMoments(moments: ScoredMoment[], limit: number): MatchMoment[] {
  const selected = uniqueMoments(moments)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
  const roundedLength = Math.floor(selected.length / 3) * 3;
  return selected
    .slice(0, roundedLength || selected.length)
    .map(({ weight: _weight, ...moment }) => moment);
}

function finalMomentLimit(playerCount: number): number {
  if (playerCount <= 10) {
    return 9;
  }
  return Math.min(24, Math.max(9, Math.ceil(playerCount / 5) * 3));
}

function buildPlayerStats(allAnswers: Array<RoundHistoryAnswer & { round: number; trackTitle: string }>, totalRounds: number) {
  const majorityByRound = new Map<number, string | undefined>();
  for (const round of new Set(allAnswers.map((answer) => answer.round))) {
    const answers = allAnswers.filter((answer) => answer.round === round);
    const counts = new Map<string, number>();
    for (const answer of answers) {
      counts.set(answer.optionId, (counts.get(answer.optionId) ?? 0) + 1);
    }
    majorityByRound.set(round, [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
  }

  const stats = new Map<string, { playerId: string; playerName: string; totalPoints: number; correct: number; rounds: number; changes: number; majorityPicks: number }>();
  for (const answer of allAnswers) {
    const current =
      stats.get(answer.playerId) ??
      { playerId: answer.playerId, playerName: answer.playerName, totalPoints: 0, correct: 0, rounds: totalRounds, changes: 0, majorityPicks: 0 };
    current.totalPoints += answer.points;
    current.correct += answer.isCorrect ? 1 : 0;
    current.changes += answer.answerChanges;
    current.majorityPicks += majorityByRound.get(answer.round) === answer.optionId ? 1 : 0;
    stats.set(answer.playerId, current);
  }
  return [...stats.values()];
}

function longestFastCorrectStreak(allAnswers: Array<RoundHistoryAnswer & { round: number }>): (RoundHistoryAnswer & { round: number }) | undefined {
  return longestStreak(allAnswers, (answer) => answer.isCorrect && answer.responseMs <= 2_000);
}

function longestFastWrongStreak(allAnswers: Array<RoundHistoryAnswer & { round: number }>): (RoundHistoryAnswer & { round: number }) | undefined {
  return longestStreak(allAnswers, (answer) => !answer.isCorrect && answer.firstResponseMs <= 2_000);
}

function longestStreak(
  allAnswers: Array<RoundHistoryAnswer & { round: number }>,
  predicate: (answer: RoundHistoryAnswer & { round: number }) => boolean
): (RoundHistoryAnswer & { round: number }) | undefined {
  const byPlayer = new Map<string, Array<RoundHistoryAnswer & { round: number }>>();
  for (const answer of allAnswers) {
    byPlayer.set(answer.playerId, [...(byPlayer.get(answer.playerId) ?? []), answer]);
  }

  let best: (RoundHistoryAnswer & { round: number; streak: number }) | undefined;
  for (const answers of byPlayer.values()) {
    let streak = 0;
    for (const answer of answers.sort((a, b) => a.round - b.round)) {
      streak = predicate(answer) ? streak + 1 : 0;
      if (streak >= 2 && (!best || streak > best.streak)) {
        best = { ...answer, streak };
      }
    }
  }
  return best;
}

function pickVariant(key: string, variants: string[]): string {
  if (variants.length === 0) {
    return '';
  }
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return variants[hash % variants.length];
}

function uniqueAchievements<T extends Achievement>(achievements: T[]): T[] {
  const seen = new Set<string>();
  return achievements.filter((achievement) => {
    const key = achievement.title;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueMoments<T extends MatchMoment>(moments: T[]): T[] {
  const seen = new Set<string>();
  return moments.filter((moment) => {
    const key = moment.title;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0);
}

function formatSignedScore(points: number): string {
  return points > 0 ? `+${points}` : String(points);
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
    answerMode: sanitizeAnswerMode(settings.answerMode, DEFAULT_SETTINGS.answerMode),
    rounds: clampInteger(settings.rounds ?? DEFAULT_SETTINGS.rounds, 1, 100),
    targetScore: clampInteger(settings.targetScore ?? DEFAULT_SETTINGS.targetScore, 500, 200_000),
    questionDurationMs: clampInteger(
      settings.questionDurationMs ?? DEFAULT_SETTINGS.questionDurationMs,
      5_000,
      maxQuestionDurationMs(settings.difficulty === 'hard' ? 'hard' : DEFAULT_SETTINGS.difficulty)
    ),
    allowAnswerChange: settings.allowAnswerChange ?? DEFAULT_SETTINGS.allowAnswerChange,
    autoNextRound: settings.autoNextRound ?? DEFAULT_SETTINGS.autoNextRound,
    achievementsEnabled: true
  };
}

function maxQuestionDurationMs(difficulty: RoomSettings['difficulty']): number {
  return difficulty === 'easy' ? 15_000 : 30_000;
}

function buildAnswerOptionCandidates(
  correctTrack: Track,
  optionTracks: TrackMetadata[],
  answerMode: RoomSettings['answerMode'],
  round: number,
  usedOptionLabels: Set<string>
): AnswerOptionCandidate[] {
  if (answerMode !== 'mixed') {
    const kind: AnswerOptionKind = answerMode === 'artist' ? 'artist' : 'title';
    const distractors = selectDistractorTracks(correctTrack, optionTracks, kind, 3, usedOptionLabels, new Set([correctTrack.id]));
    return [{ track: correctTrack, kind }, ...distractors.map((track) => ({ track, kind }))];
  }

  const correctKind: AnswerOptionKind = round % 2 === 0 ? 'artist' : 'title';
  const selected: AnswerOptionCandidate[] = [{ track: correctTrack, kind: correctKind }];
  const selectedTrackIds = new Set<string>([correctTrack.id]);
  const titleCount = correctKind === 'title' ? 1 : 0;
  const artistCount = correctKind === 'artist' ? 1 : 0;

  const titleDistractors = selectDistractorTracks(correctTrack, optionTracks, 'title', 2 - titleCount, usedOptionLabels, selectedTrackIds);
  for (const track of titleDistractors) {
    selected.push({ track, kind: 'title' });
    selectedTrackIds.add(track.id);
  }

  const artistDistractors = selectDistractorTracks(correctTrack, optionTracks, 'artist', 2 - artistCount, usedOptionLabels, selectedTrackIds);
  for (const track of artistDistractors) {
    selected.push({ track, kind: 'artist' });
    selectedTrackIds.add(track.id);
  }

  return selected;
}

function selectDistractorTracks(
  correctTrack: TrackMetadata,
  optionTracks: TrackMetadata[],
  kind: AnswerOptionKind,
  count: number,
  usedOptionLabels: Set<string>,
  excludedTrackIds: Set<string>
): TrackMetadata[] {
  if (count <= 0) {
    return [];
  }

  const correctLabel = answerOptionLabel(correctTrack, kind);
  const candidates = uniqueByOptionLabel(optionTracks, kind).filter(
    (track) => !excludedTrackIds.has(track.id) && normalizeTitle(answerOptionLabel(track, kind)) !== normalizeTitle(correctLabel)
  );
  const freshCandidates = candidates.filter((track) => !usedOptionLabels.has(normalizeTitle(answerOptionLabel(track, kind))));
  const pool = freshCandidates.length >= count ? freshCandidates : candidates;
  const sameScriptPool = pool.filter((track) => titleScriptBucket(answerOptionLabel(track, kind)) === titleScriptBucket(correctLabel));
  return shuffle(sameScriptPool.length >= count ? sameScriptPool : pool).slice(0, count);
}

function uniqueByOptionLabel<T extends TrackMetadata>(tracks: T[], kind: AnswerOptionKind): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const track of tracks) {
    const key = normalizeTitle(answerOptionLabel(track, kind));
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(track);
    }
  }

  return unique;
}

function answerOptionLabel(track: TrackMetadata, kind: AnswerOptionKind): string {
  return kind === 'artist' ? track.artist : track.title;
}

function sanitizeAnswerMode(value: unknown, fallback: RoomSettings['answerMode']): RoomSettings['answerMode'] {
  return value === 'artist' || value === 'mixed' || value === 'title' ? value : fallback;
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

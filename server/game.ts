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
  isCorrect: boolean;
  responseMs: number;
  points: number;
  answerChanges: number;
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
  achievementsEnabled: false
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
      answerMode: sanitizeAnswerMode(settings.answerMode, room.settings.answerMode),
      winCondition: settings.winCondition === 'score' ? 'score' : settings.winCondition === 'rounds' ? 'rounds' : room.settings.winCondition,
      rounds: clampInteger(settings.rounds ?? room.settings.rounds, 1, 100),
      targetScore: clampInteger(settings.targetScore ?? room.settings.targetScore, 500, 200_000),
      questionDurationMs: clampInteger(settings.questionDurationMs ?? room.settings.questionDurationMs, 5_000, maxQuestionDurationMs(difficulty)),
      allowAnswerChange: typeof settings.allowAnswerChange === 'boolean' ? settings.allowAnswerChange : room.settings.allowAnswerChange,
      achievementsEnabled: typeof settings.achievementsEnabled === 'boolean' ? settings.achievementsEnabled : room.settings.achievementsEnabled
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
    const answerChanges = player.lastAnswer ? player.lastAnswer.answerChanges + 1 : 0;
    const penalty = answerChanges * ANSWER_CHANGE_PENALTY;
    const points = isCorrect
      ? Math.max(MIN_CORRECT_POINTS, calculatePoints(responseMs, room.currentQuestion.durationMs) - penalty)
      : -Math.min(MAX_WRONG_PENALTY, penalty);

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
    lastAnswer: { hasAnswered: true, responseMs: player.lastAnswer.responseMs, answerChanges: player.lastAnswer.answerChanges }
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
  const achievements: Achievement[] = [];
  const first = answers[0];

  if (first) {
    achievements.push({
      id: `live-first-${question.id}-${first.id}`,
      icon: '⚡',
      title: 'Первый на кнопке',
      description: `${first.name} уже ткнул вариант. Уверенность или паника?`,
      recipient: first.name,
      tone: 'safe'
    });
  }

  const changer = answers.find((player) => player.lastAnswer.answerChanges > 0);
  if (changer) {
    achievements.push({
      id: `live-change-${question.id}-${changer.id}-${changer.lastAnswer.answerChanges}`,
      icon: '↔',
      title: 'Переобулся в воздухе',
      description: `${changer.name} сменил ответ. Минус очки, плюс драма.`,
      recipient: changer.name,
      tone: 'chaos'
    });
  }

  const late = answers.find((player) => player.lastAnswer.responseMs >= question.durationMs - 2_000);
  if (late) {
    achievements.push({
      id: `live-late-${question.id}-${late.id}`,
      icon: '⏱',
      title: 'На последней секунде',
      description: `${late.name} нажал так поздно, что таймер вспотел.`,
      recipient: late.name,
      tone: 'safe'
    });
  }

  if (answers.length === room.players.size && room.players.size > 1) {
    achievements.push({
      id: `live-all-${question.id}`,
      icon: '✓',
      title: 'Все в деле',
      description: 'Все ответили. Теперь ждём, кто зря был таким уверенным.',
      recipient: 'Все игроки',
      tone: 'safe'
    });
  }

  return achievements.slice(0, 3);
}

function buildRevealAchievements(room: Room): Achievement[] {
  const answers = [...room.players.values()].filter((player): player is Player & { lastAnswer: PlayerAnswerResult } => Boolean(player.lastAnswer));
  const correct = answers.filter((player) => player.lastAnswer.isCorrect);
  const achievements: Achievement[] = [];
  const round = room.currentQuestion?.round ?? room.round;

  if (correct.length === 0) {
    achievements.push({
      id: `reveal-empty-${round}`,
      icon: '💀',
      title: 'Коллективный промах',
      description: 'Никто не угадал. Трек победил людей.',
      recipient: 'Никто',
      tone: 'bad'
    });
  }

  if (correct.length === 1 && answers.length > 1) {
    achievements.push({
      id: `reveal-only-${round}-${correct[0].id}`,
      icon: '🎯',
      title: 'Один в поле угадал',
      description: `${correct[0].name} вытащил раунд, пока остальные слушали другой плейлист.`,
      recipient: correct[0].name,
      tone: 'good'
    });
  }

  const fastest = correct.sort((a, b) => a.lastAnswer.responseMs - b.lastAnswer.responseMs)[0];
  if (fastest) {
    achievements.push({
      id: `reveal-fast-${round}-${fastest.id}`,
      icon: '⚡',
      title: 'Узнал с пол-ноты',
      description: `${fastest.name}: ${formatSeconds(fastest.lastAnswer.responseMs)} сек до правильного ответа.`,
      recipient: fastest.name,
      tone: 'good'
    });
  }

  const changedCorrect = correct.find((player) => player.lastAnswer.answerChanges > 0);
  if (changedCorrect) {
    achievements.push({
      id: `reveal-change-good-${round}-${changedCorrect.id}`,
      icon: '🧠',
      title: 'Переобулся удачно',
      description: `${changedCorrect.name} сменил ответ и всё-таки попал. Мозг загрузился не сразу.`,
      recipient: changedCorrect.name,
      tone: 'good'
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
      description: `${biggestPenalty.name} сменил ответ ${biggestPenalty.lastAnswer.answerChanges} раз. Интерфейс выдержал.`,
      recipient: biggestPenalty.name,
      tone: biggestPenalty.lastAnswer.points < 0 ? 'bad' : 'chaos'
    });
  }

  return uniqueAchievements(achievements).slice(0, 4);
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
        isCorrect: player.lastAnswer.isCorrect,
        responseMs: player.lastAnswer.responseMs,
        points: player.lastAnswer.points,
        answerChanges: player.lastAnswer.answerChanges
      }))
  };
}

function buildMatchMoments(history: RoundHistoryEntry[]): MatchMoment[] {
  const candidates: MatchMoment[] = [];
  const allAnswers = history.flatMap((round) => round.answers.map((answer) => ({ ...answer, round: round.round, trackTitle: round.trackTitle })));
  const correct = allAnswers.filter((answer) => answer.isCorrect);
  const fastest = [...correct].sort((a, b) => a.responseMs - b.responseMs)[0];
  const best = [...allAnswers].sort((a, b) => b.points - a.points)[0];
  const penalty = [...allAnswers].filter((answer) => answer.answerChanges > 0).sort((a, b) => a.points - b.points)[0];
  const mostChanges = [...allAnswers].filter((answer) => answer.answerChanges > 0).sort((a, b) => b.answerChanges - a.answerChanges)[0];
  const onlyCorrectRound = history.find((round) => round.answers.filter((answer) => answer.isCorrect).length === 1 && round.answers.length > 1);
  const noCorrectRound = history.find((round) => round.answers.length > 0 && round.answers.every((answer) => !answer.isCorrect));

  if (fastest) {
    candidates.push({
      id: `moment-fast-${fastest.round}-${fastest.playerId}`,
      round: fastest.round,
      icon: '⚡',
      title: 'Самый быстрый палец',
      description: `${fastest.playerName} угадал "${fastest.trackTitle}" за ${formatSeconds(fastest.responseMs)} сек.`,
      recipient: fastest.playerName,
      tone: 'good'
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
      tone: best.points > 0 ? 'good' : 'bad'
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
      tone: 'good'
    });
  }
  if (penalty) {
    candidates.push({
      id: `moment-penalty-${penalty.round}-${penalty.playerId}`,
      round: penalty.round,
      icon: '🔁',
      title: 'Перевыбор года',
      description: `${penalty.playerName} дощёлкал до ${formatSignedScore(penalty.points)}. Зато не скучно.`,
      recipient: penalty.playerName,
      tone: 'bad'
    });
  }
  if (mostChanges) {
    candidates.push({
      id: `moment-change-${mostChanges.round}-${mostChanges.playerId}`,
      round: mostChanges.round,
      icon: '🌀',
      title: 'Крутил рулетку',
      description: `${mostChanges.playerName} сменил ответ ${mostChanges.answerChanges} раз за один раунд.`,
      recipient: mostChanges.playerName,
      tone: 'chaos'
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
      tone: 'bad'
    });
  }

  return uniqueMoments(candidates).slice(0, 5);
}

function uniqueAchievements(achievements: Achievement[]): Achievement[] {
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

function uniqueMoments(moments: MatchMoment[]): MatchMoment[] {
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
    achievementsEnabled: settings.achievementsEnabled ?? DEFAULT_SETTINGS.achievementsEnabled
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

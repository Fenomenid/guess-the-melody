export type RoomStatus = 'lobby' | 'preparing' | 'question' | 'round-result' | 'finished';

export type AnswerMode = 'title' | 'artist' | 'mixed';

export type Theme = {
  id: string;
  title: string;
  description: string;
  source: 'demo' | 'yandex';
};

export type TrackOption = {
  id: string;
  title: string;
};

export type TrackMetadata = {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string;
  trackUrl?: string;
  sourceName?: string;
  sourceUrl?: string;
};

export type Track = TrackMetadata & {
  audioUrl: string;
};

export type Question = {
  id: string;
  round: number;
  audioUrl: string;
  coverUrl?: string;
  sourceName?: string;
  options: TrackOption[];
  durationMs: number;
  startedAt: number;
  endsAt: number;
};

export type QuestionInternal = Question & {
  correctOptionId: string;
  correctTrack: Track;
  scoresApplied: boolean;
};

export type Player = {
  id: string;
  name: string;
  score: number;
  correctAnswers: number;
  currentStreak: number;
  bestStreak: number;
  rankHistory: number[];
  rankDelta: number;
  connected: boolean;
  isHost: boolean;
  comebackEnergy: number;
  pendingComebackAbility?: ComebackAbility;
  counterPrediction?: number;
  hiddenOptionIndexes?: number[];
  reducedQuestionDurationMs?: number;
  reducedQuestionEndsAt?: number;
  timecutActive?: boolean;
  comebackStatus?: 'armed' | 'jammed' | 'countered' | 'missed';
  lastAnswer?: PlayerAnswerResult;
};

export type ComebackAbility = 'jammer' | 'counter' | 'timecut';

export type PlayerAnswerResult = {
  optionId: string;
  firstOptionId: string;
  previousOptionId?: string;
  isCorrect: boolean;
  responseMs: number;
  firstResponseMs: number;
  lastResponseMs: number;
  points: number;
  basePoints: number;
  scoreMultiplier?: number;
  scoreNote?: string;
  answerChanges: number;
  answerEvents: AnswerEvent[];
};

export type AnswerEvent = {
  optionId: string;
  responseMs: number;
};

export type PublicPlayerAnswer =
  | PlayerAnswerResult
  | { hasAnswered: true; responseMs: number; firstResponseMs: number; lastResponseMs: number; answerChanges: number };

export type Achievement = {
  id: string;
  icon: string;
  title: string;
  description: string;
  recipient?: string;
  tone: 'safe' | 'good' | 'bad' | 'chaos' | 'rare';
  chainId?: string;
  chainStep?: number;
  chainTotal?: number;
};

export type MatchMoment = Achievement & {
  round: number;
};

export type RoundDrama = {
  kind: 'new-leader' | 'biggest-fall' | 'most-indecisive';
  playerId: string;
  playerName: string;
  title: string;
  description: string;
  value: number;
};

export type PlaylistSource = {
  url: string;
  name: string;
};

export type PlaylistSearchItem = PlaylistSource & {
  id: string;
  description?: string;
  trackCount?: number;
};

export type RoomSettings = {
  themeId: string;
  themeIds: string[];
  playlistUrl?: string;
  playlistUrls?: string[];
  playlistSources?: PlaylistSource[];
  difficulty: 'easy' | 'hard';
  answerMode: AnswerMode;
  winCondition: 'rounds' | 'score';
  rounds: number;
  targetScore: number;
  questionDurationMs: number;
  allowAnswerChange: boolean;
  autoNextRound: boolean;
  achievementsEnabled: boolean;
  comebackMode: boolean;
};

export type ComebackState = {
  queuedJammerPlayerId?: string;
  queuedJammerPlayerName?: string;
  automaticJammerQueued?: boolean;
  automaticJammerTargetPlayerId?: string;
  automaticJammerTargetPlayerName?: string;
  lastAutomaticJammerRound?: number;
  queuedTimecutPlayerId?: string;
  queuedTimecutPlayerName?: string;
  lastJammerPlayerId?: string;
  lastJammerPlayerName?: string;
  lastTimecutPlayerId?: string;
  lastTimecutPlayerName?: string;
  lastAttackingPlayerIds?: string[];
};

export type PublicRoom = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: PublicPlayer[];
  currentQuestion?: Question;
  correctTrack?: Track;
  achievements: Achievement[];
  matchMoments: MatchMoment[];
  roundDrama: RoundDrama[];
  comeback?: ComebackState;
  round: number;
  serverTime: number;
};

export type PublicPlayer = Omit<Player, 'lastAnswer'> & {
  lastAnswer?: PublicPlayerAnswer;
};

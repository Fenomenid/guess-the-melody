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
  connected: boolean;
  isHost: boolean;
  lastAnswer?: PlayerAnswerResult;
};

export type PlayerAnswerResult = {
  optionId: string;
  firstOptionId: string;
  previousOptionId?: string;
  isCorrect: boolean;
  responseMs: number;
  firstResponseMs: number;
  lastResponseMs: number;
  points: number;
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
  tone: 'safe' | 'good' | 'bad' | 'chaos';
  chainId?: string;
  chainStep?: number;
  chainTotal?: number;
};

export type MatchMoment = Achievement & {
  round: number;
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
  round: number;
  serverTime: number;
};

export type PublicPlayer = Omit<Player, 'lastAnswer'> & {
  lastAnswer?: PublicPlayerAnswer;
};

export type RoomStatus = 'lobby' | 'preparing' | 'question' | 'round-result' | 'finished';

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
  isCorrect: boolean;
  responseMs: number;
  points: number;
  answerChanges: number;
};

export type PublicPlayerAnswer = PlayerAnswerResult | { hasAnswered: true };

export type PlaylistSource = {
  url: string;
  name: string;
};

export type PlaylistSearchItem = PlaylistSource & {
  id: string;
  description?: string;
};

export type RoomSettings = {
  themeId: string;
  themeIds: string[];
  playlistUrl?: string;
  playlistUrls?: string[];
  playlistSources?: PlaylistSource[];
  difficulty: 'easy' | 'hard';
  winCondition: 'rounds' | 'score';
  rounds: number;
  targetScore: number;
  questionDurationMs: number;
  allowAnswerChange: boolean;
  achievementsEnabled: boolean;
};

export type PublicRoom = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: PublicPlayer[];
  currentQuestion?: Question;
  correctTrack?: Track;
  round: number;
  serverTime: number;
};

export type PublicPlayer = Omit<Player, 'lastAnswer'> & {
  lastAnswer?: PublicPlayerAnswer;
};

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
};

export type Track = TrackMetadata & {
  audioUrl: string;
};

export type Question = {
  id: string;
  round: number;
  audioUrl: string;
  coverUrl?: string;
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
  connected: boolean;
  isHost: boolean;
  lastAnswer?: PlayerAnswerResult;
};

export type PlayerAnswerResult = {
  optionId: string;
  isCorrect: boolean;
  responseMs: number;
  points: number;
};

export type RoomSettings = {
  themeId: string;
  themeIds: string[];
  playlistUrl?: string;
  playlistUrls?: string[];
  winCondition: 'rounds' | 'score';
  rounds: number;
  targetScore: number;
  questionDurationMs: number;
  allowAnswerChange: boolean;
};

export type PublicRoom = {
  code: string;
  status: RoomStatus;
  settings: RoomSettings;
  players: Player[];
  currentQuestion?: Question;
  correctTrack?: Track;
  round: number;
  serverTime: number;
};

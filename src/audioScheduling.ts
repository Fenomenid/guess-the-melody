type ScheduledQuestion = {
  id: string;
  audioUrl: string;
  startedAt: number;
};

type ResettableAudioElement = {
  currentTime: number;
  pause: () => void;
};

type AudioDiagnosticInput = {
  event: string;
  questionId: string;
  scheduledStartAt: number;
  now: number;
  audio: {
    currentTime: number;
    readyState: number;
    networkState: number;
    paused: boolean;
    errorCode: number | null;
  };
};

export function getQuestionAudioSessionKey(question: ScheduledQuestion): string {
  return `${question.id}:${question.audioUrl}:${question.startedAt}`;
}

export function isSameAudioElementSource(previousSrc: string | undefined, nextSrc: string | undefined): boolean {
  return previousSrc === nextSrc;
}

export function resetQuestionAudioElement(audio: ResettableAudioElement): void {
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Remote media may reject seeking until metadata is available.
  }
}

export function createAudioDiagnosticEntry({ event, questionId, scheduledStartAt, now, audio }: AudioDiagnosticInput) {
  return {
    event,
    questionId,
    millisecondsFromScheduledStart: Math.round(now - scheduledStartAt),
    currentTimeSeconds: audio.currentTime,
    readyState: audio.readyState,
    networkState: audio.networkState,
    paused: audio.paused,
    errorCode: audio.errorCode
  };
}

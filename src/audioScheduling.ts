type ScheduledQuestion = {
  id: string;
  audioUrl: string;
  startedAt: number;
};

export function getQuestionAudioSessionKey(question: ScheduledQuestion): string {
  return `${question.id}:${question.audioUrl}:${question.startedAt}`;
}

export function isSameAudioElementSource(previousSrc: string | undefined, nextSrc: string | undefined): boolean {
  return previousSrc === nextSrc;
}

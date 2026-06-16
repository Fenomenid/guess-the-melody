type ScheduledQuestion = {
  id: string;
  audioUrl: string;
  startedAt: number;
};

export function getQuestionAudioSessionKey(question: ScheduledQuestion): string {
  return `${question.id}:${question.audioUrl}:${question.startedAt}`;
}

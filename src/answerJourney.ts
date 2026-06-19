type AnswerEvent = { optionId: string; responseMs: number };
type AnswerOption = { id: string; title: string };

export type AnswerJourneyStep = {
  optionId: string;
  title: string;
  timeLabel: string;
};

export function buildAnswerJourney(events: AnswerEvent[], options: AnswerOption[]): AnswerJourneyStep[] {
  if (events.length < 2) return [];
  const titles = new Map(options.map((option) => [option.id, option.title]));
  return events.map((event) => ({
    optionId: event.optionId,
    title: titles.get(event.optionId) ?? 'Неизвестный вариант',
    timeLabel: `${(event.responseMs / 1000).toLocaleString('ru-RU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    })} с`
  }));
}

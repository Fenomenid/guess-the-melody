import { describe, expect, it } from 'vitest';
import { buildAnswerJourney } from './answerJourney';

const options = [
  { id: 'a', title: 'Альфа' },
  { id: 'b', title: 'Бета' },
  { id: 'c', title: 'Гамма' }
];

describe('buildAnswerJourney', () => {
  it('builds the full sequence of changed answers with relative timestamps', () => {
    expect(
      buildAnswerJourney(
        [
          { optionId: 'a', responseMs: 1200 },
          { optionId: 'b', responseMs: 3400 },
          { optionId: 'c', responseMs: 5700 }
        ],
        options
      )
    ).toEqual([
      { optionId: 'a', title: 'Альфа', timeLabel: '1,2 с' },
      { optionId: 'b', title: 'Бета', timeLabel: '3,4 с' },
      { optionId: 'c', title: 'Гамма', timeLabel: '5,7 с' }
    ]);
  });

  it('returns no journey when the player never changed the answer', () => {
    expect(buildAnswerJourney([{ optionId: 'a', responseMs: 1200 }], options)).toEqual([]);
  });
});

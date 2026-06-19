import { describe, expect, it } from 'vitest';
import { getVisibleFinalPlayers } from './finalStageLayout';

const players = Array.from({ length: 11 }, (_, index) => ({ id: `p${index + 1}` }));

describe('final stage ranking', () => {
  it('shows the first eight players by default', () => {
    expect(getVisibleFinalPlayers(players, false)).toEqual({
      visiblePlayers: players.slice(0, 8),
      hiddenCount: 3
    });
  });

  it('shows the complete ranking after expansion', () => {
    expect(getVisibleFinalPlayers(players, true)).toEqual({
      visiblePlayers: players,
      hiddenCount: 0
    });
  });
});

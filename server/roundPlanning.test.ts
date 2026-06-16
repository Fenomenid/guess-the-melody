import { describe, expect, it } from 'vitest';
import { planRoundStart, planTrackPoolLimits } from './roundPlanning';

describe('round planning', () => {
  it('starts the answer timer after an audio warmup window', () => {
    expect(planRoundStart(10_000, 1_750)).toBe(11_750);
  });

  it('loads a small initial playable pool while keeping answer options broad', () => {
    expect(planTrackPoolLimits(60)).toEqual({
      initialPlayableLimit: 16,
      initialOptionLimit: 260,
      backgroundPlayableLimit: 90,
      backgroundOptionLimit: 1080,
      shouldLoadInBackground: true
    });
  });

  it('loads enough playable tracks up front for short games', () => {
    expect(planTrackPoolLimits(5)).toEqual({
      initialPlayableLimit: 25,
      initialOptionLimit: 260,
      backgroundPlayableLimit: 35,
      backgroundOptionLimit: 260,
      shouldLoadInBackground: false
    });
  });
});

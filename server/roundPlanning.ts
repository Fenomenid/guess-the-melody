export type TrackPoolLimits = {
  initialPlayableLimit: number;
  initialOptionLimit: number;
  backgroundPlayableLimit: number;
  backgroundOptionLimit: number;
  shouldLoadInBackground: boolean;
};

const BACKGROUND_POOL_ROUND_THRESHOLD = 24;
const INITIAL_PLAYABLE_LIMIT = 16;
const MIN_OPTION_LIMIT = 260;

export function planRoundStart(now: number, warmupMs: number): number {
  return now + Math.max(0, Math.round(warmupMs));
}

export function planTrackPoolLimits(plannedRounds: number): TrackPoolLimits {
  const roundedRounds = Math.max(1, Math.round(plannedRounds));
  const shouldLoadInBackground = roundedRounds > BACKGROUND_POOL_ROUND_THRESHOLD;

  return {
    initialPlayableLimit: shouldLoadInBackground ? INITIAL_PLAYABLE_LIMIT : Math.max(12, roundedRounds + 20),
    initialOptionLimit: shouldLoadInBackground ? MIN_OPTION_LIMIT : Math.max(MIN_OPTION_LIMIT, roundedRounds * 18),
    backgroundPlayableLimit: Math.max(INITIAL_PLAYABLE_LIMIT, roundedRounds + 30),
    backgroundOptionLimit: Math.max(MIN_OPTION_LIMIT, roundedRounds * 18),
    shouldLoadInBackground
  };
}

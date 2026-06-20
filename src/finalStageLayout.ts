export function getVisibleFinalPlayers<T>(players: T[], expanded: boolean, limit = 8): {
  visiblePlayers: T[];
  hiddenCount: number;
} {
  if (expanded || players.length <= limit) {
    return { visiblePlayers: players, hiddenCount: 0 };
  }
  return {
    visiblePlayers: players.slice(0, limit),
    hiddenCount: players.length - limit
  };
}

export function getVisibleMatchMoments<T>(moments: T[], expanded: boolean, limit = 6): {
  visibleMoments: T[];
  hiddenCount: number;
} {
  if (expanded || moments.length <= limit) {
    return { visibleMoments: moments, hiddenCount: 0 };
  }
  return {
    visibleMoments: moments.slice(0, limit),
    hiddenCount: moments.length - limit
  };
}

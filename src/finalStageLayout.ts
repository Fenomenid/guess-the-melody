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

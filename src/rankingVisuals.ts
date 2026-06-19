export type GeometricAvatar = {
  hue: number;
  accentHue: number;
  eyeOffset: number;
  mouthTilt: number;
  shape: 'circle' | 'squircle' | 'diamond';
};

type RankingPlayer = {
  id: string;
  connected: boolean;
};

type RankingComeback = {
  queuedJammerPlayerId?: string;
  automaticJammerQueued?: boolean;
  automaticJammerTargetPlayerId?: string;
  queuedTimecutPlayerId?: string;
};

export type RankingAttack = {
  kind: 'jammer' | 'timecut';
  sourceId: string;
  targetId: string;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createGeometricAvatar(playerId: string): GeometricAvatar {
  const hash = hashString(playerId);
  const shapes: GeometricAvatar['shape'][] = ['circle', 'squircle', 'diamond'];
  return {
    hue: hash % 360,
    accentHue: (hash * 7 + 83) % 360,
    eyeOffset: 7 + (hash % 4),
    mouthTilt: ((hash >>> 4) % 13) - 6,
    shape: shapes[(hash >>> 8) % shapes.length]
  };
}

export function getRankingAttack(players: RankingPlayer[], comeback?: RankingComeback): RankingAttack | undefined {
  const leader = players.find((player) => player.connected);
  if (!leader) return undefined;

  if (comeback?.queuedTimecutPlayerId && comeback.queuedTimecutPlayerId !== leader.id) {
    return { kind: 'timecut', sourceId: comeback.queuedTimecutPlayerId, targetId: leader.id };
  }
  if (comeback?.queuedJammerPlayerId && comeback.queuedJammerPlayerId !== leader.id) {
    return { kind: 'jammer', sourceId: comeback.queuedJammerPlayerId, targetId: leader.id };
  }
  if (comeback?.automaticJammerQueued && comeback.automaticJammerTargetPlayerId) {
    const source = [...players]
      .reverse()
      .find((player) => player.connected && player.id !== comeback.automaticJammerTargetPlayerId);
    if (source) {
      return {
        kind: 'jammer',
        sourceId: source.id,
        targetId: comeback.automaticJammerTargetPlayerId
      };
    }
  }
  return undefined;
}

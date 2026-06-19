import { describe, expect, it } from 'vitest';
import { createGeometricAvatar, getRankingAttack } from './rankingVisuals';

describe('ranking visuals', () => {
  it('builds a stable geometric avatar from the player id', () => {
    expect(createGeometricAvatar('player-42')).toEqual(createGeometricAvatar('player-42'));
    expect(createGeometricAvatar('player-42')).not.toEqual(createGeometricAvatar('player-43'));
  });

  it('connects a queued timecut attacker to the current leader', () => {
    expect(
      getRankingAttack(
        [
          { id: 'leader', connected: true },
          { id: 'attacker', connected: true }
        ],
        { queuedTimecutPlayerId: 'attacker' }
      )
    ).toEqual({ kind: 'timecut', sourceId: 'attacker', targetId: 'leader' });
  });

  it('launches an automatic jammer from the last connected chaser', () => {
    expect(
      getRankingAttack(
        [
          { id: 'leader', connected: true },
          { id: 'middle', connected: true },
          { id: 'last', connected: true }
        ],
        { automaticJammerQueued: true, automaticJammerTargetPlayerId: 'leader' }
      )
    ).toEqual({ kind: 'jammer', sourceId: 'last', targetId: 'leader' });
  });
});

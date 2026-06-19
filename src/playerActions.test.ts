import { describe, expect, it } from 'vitest';
import { canHostKickPlayer } from './playerActions';

describe('canHostKickPlayer', () => {
  it('allows the host to kick another player during an active question', () => {
    expect(
      canHostKickPlayer({
        isHost: true,
        currentPlayerId: 'host',
        targetPlayerId: 'guest',
        roomStatus: 'question'
      })
    ).toBe(true);
  });

  it('does not allow kicking from the final results or kicking yourself', () => {
    expect(
      canHostKickPlayer({
        isHost: true,
        currentPlayerId: 'host',
        targetPlayerId: 'guest',
        roomStatus: 'finished'
      })
    ).toBe(false);
    expect(
      canHostKickPlayer({
        isHost: true,
        currentPlayerId: 'host',
        targetPlayerId: 'host',
        roomStatus: 'question'
      })
    ).toBe(false);
  });
});

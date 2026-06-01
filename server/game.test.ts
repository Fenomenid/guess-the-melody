import { describe, expect, it } from 'vitest';
import { GameEngine } from './game';
import type { Track } from './types';

const tracks: Track[] = [
  { id: '1', title: 'Ночь', artist: 'Кино', audioUrl: 'https://example.test/1.mp3' },
  { id: '2', title: 'Звезда', artist: 'Кино', audioUrl: 'https://example.test/2.mp3' },
  { id: '3', title: 'Группа крови', artist: 'Кино', audioUrl: 'https://example.test/3.mp3' },
  { id: '4', title: 'Пачка сигарет', artist: 'Кино', audioUrl: 'https://example.test/4.mp3' }
];

describe('GameEngine', () => {
  it('creates a room and marks the creator as host', () => {
    const engine = new GameEngine();
    const room = engine.createRoom({ playerId: 'p1', playerName: 'Host' });

    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ id: 'p1', isHost: true, connected: true });
  });

  it('starts a round with four answer options and no public correct answer', () => {
    const engine = new GameEngine();
    const room = engine.createRoom({ playerId: 'p1', playerName: 'Host' });

    const question = engine.startNextRound(room.code, tracks, 1000);
    const publicRoom = engine.getPublicRoom(room.code);

    expect(question.options).toHaveLength(4);
    expect(publicRoom.currentQuestion?.options).toHaveLength(4);
    expect(publicRoom.correctTrack).toBeUndefined();
  });

  it('scores a fast correct answer higher than a slow correct answer', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.joinRoom('ROOM42', { playerId: 'fast', playerName: 'Fast' });
    engine.joinRoom('ROOM42', { playerId: 'slow', playerName: 'Slow' });

    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const fast = engine.submitAnswer('ROOM42', 'fast', question.correctOptionId, 2000);
    const slow = engine.submitAnswer('ROOM42', 'slow', question.correctOptionId, 9000);

    expect(fast.isCorrect).toBe(true);
    expect(slow.isCorrect).toBe(true);
    expect(fast.points).toBeGreaterThan(slow.points);
  });

  it('keeps scores hidden until the round is revealed', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);

    expect(engine.getPublicRoom('ROOM42').players[0].score).toBe(0);
    expect(engine.revealRound('ROOM42').players[0].score).toBeGreaterThan(0);
  });

  it('marks the room as preparing while tracks are loading', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    expect(engine.markPreparing('ROOM42').status).toBe('preparing');
  });

  it('promotes another player when the host leaves', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.joinRoom('ROOM42', { playerId: 'guest', playerName: 'Guest' });

    const result = engine.leaveRoom('ROOM42', 'host');

    expect(result.room?.players).toHaveLength(1);
    expect(result.room?.players[0]).toMatchObject({ id: 'guest', isHost: true });
  });

  it('does not repeat the correct track in the same room before the pool is exhausted', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const playedTrackIds = new Set<string>();
    for (let index = 0; index < tracks.length; index += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000 + index);
      expect(playedTrackIds.has(question.correctTrack.id)).toBe(false);
      playedTrackIds.add(question.correctTrack.id);
      engine.revealRound('ROOM42');
    }
  });

  it('keeps the room track history after returning to lobby', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const firstQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    engine.revealRound('ROOM42');
    engine.resetToLobby('ROOM42');

    for (let index = 0; index < tracks.length - 1; index += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 2000 + index);
      expect(question.correctTrack.id).not.toBe(firstQuestion.correctTrack.id);
      engine.revealRound('ROOM42');
    }
  });

  it('rejects duplicate answers from the same player', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);

    expect(() => engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 3000)).toThrow(
      'Player already answered'
    );
  });
});

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

  it('can build answer options from a larger metadata pool', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const narrowPlayablePool: Track[] = tracks.map((track, index) => ({
      ...track,
      title: index === 0 ? 'Correct song' : 'Correct song'
    }));
    const optionPool = [
      ...narrowPlayablePool,
      { id: 'option-1', title: 'Wrong one', artist: 'Artist' },
      { id: 'option-2', title: 'Wrong two', artist: 'Artist' },
      { id: 'option-3', title: 'Wrong three', artist: 'Artist' },
      { id: 'option-4', title: 'Wrong four', artist: 'Artist' }
    ];

    const question = engine.startNextRound('ROOM42', narrowPlayablePool, optionPool, 10_000, 1000);

    expect(question.options).toHaveLength(4);
    expect(new Set(question.options.map((option) => option.title)).size).toBe(4);
  });

  it('prefers answer options with the same title script as the correct track', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const cyrillicTracks: Track[] = [
      { id: 'ru-1', title: 'Ночь', artist: 'Artist', audioUrl: 'https://example.test/1.mp3' },
      { id: 'ru-2', title: 'Звезда', artist: 'Artist', audioUrl: 'https://example.test/2.mp3' },
      { id: 'ru-3', title: 'Город', artist: 'Artist', audioUrl: 'https://example.test/3.mp3' },
      { id: 'ru-4', title: 'Река', artist: 'Artist', audioUrl: 'https://example.test/4.mp3' }
    ];
    const optionPool = [
      ...cyrillicTracks,
      { id: 'en-1', title: 'Night', artist: 'Artist' },
      { id: 'en-2', title: 'Star', artist: 'Artist' },
      { id: 'en-3', title: 'River', artist: 'Artist' }
    ];

    const question = engine.startNextRound('ROOM42', cyrillicTracks, optionPool, 10_000, 1000);

    expect(question.options).toHaveLength(4);
    expect(question.options.every((option) => /[А-Яа-яЁё]/.test(option.title))).toBe(true);
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

  it('publishes server time and round end time for synchronized countdowns', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const publicRoom = engine.getPublicRoom('ROOM42');

    expect(question.endsAt).toBe(11_000);
    expect(publicRoom.currentQuestion?.endsAt).toBe(11_000);
    expect(publicRoom.serverTime).toEqual(expect.any(Number));
  });

  it('can finish the game by target score instead of round count', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { winCondition: 'score', targetScore: 500, rounds: 20 });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);
    const revealed = engine.revealRound('ROOM42');

    expect(revealed.status).toBe('finished');
  });

  it('allows playlist-only settings when a playlist URL is configured', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', {
      playlistUrl: 'https://music.yandex.ru/users/example/playlists/1000',
      themeIds: []
    });

    expect(room.settings.playlistUrl).toBe('https://music.yandex.ru/users/example/playlists/1000');
    expect(room.settings.themeIds).toEqual([]);
    expect(room.settings.themeId).toBe('chart-russia');
  });

  it('falls back to a default theme when playlist URL is cleared with no themes selected', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', {
      playlistUrl: 'https://music.yandex.ru/users/example/playlists/1000',
      themeIds: []
    });

    const room = engine.updateSettings('ROOM42', { playlistUrl: '', themeIds: [] });

    expect(room.settings.playlistUrl).toBeUndefined();
    expect(room.settings.themeIds).toEqual(['chart-russia']);
    expect(room.settings.themeId).toBe('chart-russia');
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

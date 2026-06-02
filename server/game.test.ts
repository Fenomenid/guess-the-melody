import { describe, expect, it, vi } from 'vitest';
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
    expect(room.settings.themeIds).toEqual([]);
    expect(room.settings.questionDurationMs).toBe(10_000);
    expect(room.settings.targetScore).toBe(10_000);
    expect(room.settings.achievementsEnabled).toBe(false);
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

  it('hides selected option details until the round is revealed', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);

    const hiddenAnswer = engine.getPublicRoom('ROOM42').players[0].lastAnswer;
    const revealedAnswer = engine.revealRound('ROOM42').players[0].lastAnswer;

    expect(hiddenAnswer).toEqual({ hasAnswered: true });
    expect(revealedAnswer).toMatchObject({ optionId: question.correctOptionId, isCorrect: true });
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

  it('publishes the playlist source for the current and revealed track', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const sourcedTracks: Track[] = tracks.map((track) => ({
      ...track,
      sourceName: 'Дорога',
      sourceUrl: 'https://music.yandex.ru/users/example/playlists/1000'
    }));

    engine.startNextRound('ROOM42', sourcedTracks, 10_000, 1000);

    expect(engine.getPublicRoom('ROOM42').currentQuestion?.sourceName).toBe('Дорога');
    expect(engine.revealRound('ROOM42').correctTrack?.sourceName).toBe('Дорога');
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

  it('orders final standings by total score instead of last round points', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.updateSettings('ROOM42', { rounds: 2 });

    const firstQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    engine.submitAnswer('ROOM42', 'leader', firstQuestion.correctOptionId, 1000);
    engine.revealRound('ROOM42');

    const secondQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 20_000);
    engine.submitAnswer('ROOM42', 'leader', secondQuestion.correctOptionId, 29_000);
    engine.submitAnswer('ROOM42', 'chaser', secondQuestion.correctOptionId, 21_000);
    const finalRoom = engine.revealRound('ROOM42');

    expect(finalRoom.status).toBe('finished');
    expect(finalRoom.players[0]).toMatchObject({ id: 'leader' });
    expect(finalRoom.players[0].score).toBeGreaterThan(finalRoom.players[1].score);
    expect(finalRoom.players[0].lastAnswer).toMatchObject({ points: 550 });
    expect(finalRoom.players[1].lastAnswer).toMatchObject({ points: 950 });
  });

  it('allows longer games and higher score targets', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', { rounds: 100, targetScore: 200_000 });

    expect(room.settings.rounds).toBe(100);
    expect(room.settings.targetScore).toBe(200_000);
  });

  it('stores the selected difficulty in room settings', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const hardRoom = engine.updateSettings('ROOM42', { difficulty: 'hard' });
    const easyRoom = engine.updateSettings('ROOM42', { difficulty: 'easy' });

    expect(hardRoom.settings.difficulty).toBe('hard');
    expect(easyRoom.settings.difficulty).toBe('easy');
  });

  it('can enable beta achievements in room settings', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', { achievementsEnabled: true });

    expect(room.settings.achievementsEnabled).toBe(true);
  });

  it('limits easy mode answer time to fifteen seconds', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const hardRoom = engine.updateSettings('ROOM42', { difficulty: 'hard', questionDurationMs: 30_000 });
    const easyRoom = engine.updateSettings('ROOM42', { difficulty: 'easy' });
    const explicitEasyRoom = engine.updateSettings('ROOM42', { questionDurationMs: 30_000 });

    expect(hardRoom.settings.questionDurationMs).toBe(30_000);
    expect(easyRoom.settings.questionDurationMs).toBe(15_000);
    expect(explicitEasyRoom.settings.questionDurationMs).toBe(15_000);
  });

  it('rejects host-only actions from regular players', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.joinRoom('ROOM42', { playerId: 'guest', playerName: 'Guest' });

    expect(() => engine.assertHost('ROOM42', 'guest')).toThrow('Only host can perform this action');
    expect(() => engine.assertHost('ROOM42', 'host')).not.toThrow();
  });

  it('keeps the default empty theme selection when unrelated settings change', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', { rounds: 12 });

    expect(room.settings.rounds).toBe(12);
    expect(room.settings.themeIds).toEqual([]);
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

  it('allows playlist-only settings with multiple playlist URLs', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', {
      playlistUrls: [
        'https://music.yandex.ru/users/example/playlists/1000',
        'https://music.yandex.ru/users/example/playlists/2000'
      ],
      themeIds: []
    });

    expect(room.settings.playlistUrls).toEqual([
      'https://music.yandex.ru/users/example/playlists/1000',
      'https://music.yandex.ru/users/example/playlists/2000'
    ]);
    expect(room.settings.playlistUrl).toBe('https://music.yandex.ru/users/example/playlists/1000');
    expect(room.settings.themeIds).toEqual([]);
  });

  it('keeps custom playlist source names and legacy URL fields in sync', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });

    const room = engine.updateSettings('ROOM42', {
      playlistSources: [
        { url: 'https://music.yandex.ru/users/example/playlists/1000', name: 'Дорога' },
        { url: 'https://music.yandex.ru/album/2000', name: '' }
      ],
      themeIds: []
    });

    expect(room.settings.playlistSources).toEqual([
      { url: 'https://music.yandex.ru/users/example/playlists/1000', name: 'Дорога' },
      { url: 'https://music.yandex.ru/album/2000', name: 'Альбом 2' }
    ]);
    expect(room.settings.playlistUrls).toEqual([
      'https://music.yandex.ru/users/example/playlists/1000',
      'https://music.yandex.ru/album/2000'
    ]);
    expect(room.settings.playlistUrl).toBe('https://music.yandex.ru/users/example/playlists/1000');
    expect(room.settings.themeIds).toEqual([]);
  });

  it('keeps up to ten playlist or album URLs', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const urls = Array.from({ length: 12 }, (_, index) => `https://music.yandex.ru/album/${1000 + index}`);

    const room = engine.updateSettings('ROOM42', { playlistUrls: urls, themeIds: [] });

    expect(room.settings.playlistUrls).toHaveLength(10);
    expect(room.settings.playlistUrls?.at(0)).toBe('https://music.yandex.ru/album/1000');
    expect(room.settings.playlistUrls?.at(-1)).toBe('https://music.yandex.ru/album/1009');
  });

  it('keeps quick themes empty when playlist URL is cleared', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', {
      playlistUrl: 'https://music.yandex.ru/users/example/playlists/1000',
      themeIds: []
    });

    const room = engine.updateSettings('ROOM42', { playlistUrl: '', themeIds: [] });

    expect(room.settings.playlistUrl).toBeUndefined();
    expect(room.settings.themeIds).toEqual([]);
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

  it('balances correct tracks between playlist sources while both have fresh tracks', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const sourcedTracks: Track[] = Array.from({ length: 12 }, (_, index) => ({
      id: `track-${index}`,
      title: `Song ${index}`,
      artist: 'Artist',
      audioUrl: `https://example.test/${index}.mp3`,
      sourceName: index < 6 ? 'Плейлист 1' : 'Плейлист 2',
      sourceUrl: index < 6 ? 'https://music.yandex.ru/users/example/playlists/1' : 'https://music.yandex.ru/users/example/playlists/2'
    }));
    const counts = new Map<string, number>();

    try {
      for (let index = 0; index < 4; index += 1) {
        const question = engine.startNextRound('ROOM42', sourcedTracks, 10_000, 1000 + index);
        const sourceName = question.correctTrack.sourceName!;
        counts.set(sourceName, (counts.get(sourceName) ?? 0) + 1);
        engine.revealRound('ROOM42');
      }
    } finally {
      randomSpy.mockRestore();
    }

    expect(Math.abs((counts.get('Плейлист 1') ?? 0) - (counts.get('Плейлист 2') ?? 0))).toBeLessThanOrEqual(1);
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

  it('rejects answers submitted after the round deadline', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    expect(() => engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 11_001)).toThrow(
      'Answer deadline has passed'
    );
  });

  it('allows changing an answer before reveal when enabled', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const wrongOption = question.options.find((option) => option.id !== question.correctOptionId)!;

    const first = engine.submitAnswer('ROOM42', 'host', wrongOption.id, 2000);
    const second = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 3000);
    const revealed = engine.revealRound('ROOM42');

    expect(first.isCorrect).toBe(false);
    expect(second.isCorrect).toBe(true);
    expect(second.answerChanges).toBe(1);
    expect(second.points).toBe(850);
    expect(revealed.players[0].lastAnswer).toMatchObject({ optionId: question.correctOptionId });
    expect(revealed.players[0].score).toBe(second.points);
  });

  it('subtracts a small penalty for answer reselection', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const wrongOption = question.options.find((option) => option.id !== question.correctOptionId)!;

    engine.submitAnswer('ROOM42', 'host', wrongOption.id, 2000);
    const corrected = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 3000);
    const repeated = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 4000);

    expect(corrected).toMatchObject({ isCorrect: true, answerChanges: 1, points: 850 });
    expect(repeated).toMatchObject({ isCorrect: true, answerChanges: 1, points: 850, responseMs: 2000 });
  });
});

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
    expect(room.settings.answerMode).toBe('title');
    expect(room.settings.autoNextRound).toBe(true);
    expect(room.settings.achievementsEnabled).toBe(true);
    expect(room.settings.comebackMode).toBe(false);
  });

  it('charges comeback energy after correct answers when Revansh mode is enabled', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 2000);
    engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 3000);

    expect(engine.getPublicRoom('ROOM42').players.every((player) => player.comebackEnergy === 0)).toBe(true);

    const revealed = engine.revealRound('ROOM42');
    const leader = revealed.players.find((player) => player.id === 'leader');
    const chaser = revealed.players.find((player) => player.id === 'chaser');

    expect(leader?.comebackEnergy).toBeGreaterThan(0);
    expect(chaser?.comebackEnergy).toBeGreaterThan(leader?.comebackEnergy ?? 0);
  });

  it('arms one jammer that hides exactly two different answers from the leader in the next round', () => {
    const randomValues = [0.1, 0.8];
    const engine = new GameEngine(() => 'ROOM42', () => randomValues.shift() ?? 0.5);
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    for (let round = 0; round < 3; round += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 1100 + round * 20_000);
      engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 9000 + round * 20_000);
      engine.revealRound('ROOM42');
    }

    const armed = engine.activateComebackAbility('ROOM42', 'chaser');
    expect(armed.comeback?.queuedJammerPlayerId).toBe('chaser');

    engine.startNextRound('ROOM42', tracks, 10_000, 100_000);
    const nextRoom = engine.getPublicRoom('ROOM42');
    const leader = nextRoom.players.find((player) => player.id === 'leader');
    const chaser = nextRoom.players.find((player) => player.id === 'chaser');

    expect(leader?.hiddenOptionIndexes).toHaveLength(2);
    expect(new Set(leader?.hiddenOptionIndexes).size).toBe(2);
    expect(leader?.hiddenOptionIndexes?.every((index) => index >= 0 && index < 4)).toBe(true);
    expect(chaser?.hiddenOptionIndexes).toBeUndefined();
  });

  it('lets the leader predict one jammed slot and reveal it', () => {
    const randomValues = [0.51, 0.9];
    const engine = new GameEngine(() => 'ROOM42', () => randomValues.shift() ?? 0.1);
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    for (let round = 0; round < 3; round += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 1100 + round * 20_000);
      engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 9000 + round * 20_000);
      engine.revealRound('ROOM42');
    }

    engine.activateComebackAbility('ROOM42', 'chaser');
    engine.activateComebackAbility('ROOM42', 'leader', 2);
    const energyBefore = engine.getPublicRoom('ROOM42').players.find((player) => player.id === 'leader')?.comebackEnergy ?? 0;

    engine.startNextRound('ROOM42', tracks, 10_000, 100_000);
    const leader = engine.getPublicRoom('ROOM42').players.find((player) => player.id === 'leader');

    expect(leader?.hiddenOptionIndexes).toEqual([3]);
    expect(leader?.comebackStatus).toBe('countered');
    expect(leader?.comebackEnergy).toBeGreaterThan(energyBefore);

    const activeQuestion = engine.getPublicRoom('ROOM42').currentQuestion!;
    engine.submitAnswer('ROOM42', 'leader', activeQuestion.options[0].id, 101_000);
    const revealed = engine.revealRound('ROOM42');
    expect(revealed.achievements.some((achievement) => achievement.title === 'Контрразведка')).toBe(true);
  });

  it('prevents the same player from arming Jammer twice in a row when at least three players are present', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.joinRoom('ROOM42', { playerId: 'other', playerName: 'Other' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    for (let round = 0; round < 3; round += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 1100 + round * 20_000);
      engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 8000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'other', question.correctOptionId, 8500 + round * 20_000);
      engine.revealRound('ROOM42');
    }

    engine.activateComebackAbility('ROOM42', 'chaser');
    const jammedQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 100_000);
    engine.submitAnswer('ROOM42', 'leader', jammedQuestion.correctOptionId, 101_000);
    engine.submitAnswer('ROOM42', 'chaser', jammedQuestion.correctOptionId, 108_000);
    engine.submitAnswer('ROOM42', 'other', jammedQuestion.correctOptionId, 108_500);
    engine.revealRound('ROOM42');

    expect(() => engine.activateComebackAbility('ROOM42', 'chaser')).toThrow('another player');
    expect(engine.activateComebackAbility('ROOM42', 'other').comeback?.queuedJammerPlayerId).toBe('other');
  });

  it('allows different chasers to stack Jammer and Timecut while one player can arm only one ability', () => {
    const randomValues = [0.1, 0.8];
    const engine = new GameEngine(() => 'ROOM42', () => randomValues.shift() ?? 0.5);
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.joinRoom('ROOM42', { playerId: 'other', playerName: 'Other' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    for (let round = 0; round < 3; round += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 1100 + round * 20_000);
      engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 8000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'other', question.correctOptionId, 8500 + round * 20_000);
      engine.revealRound('ROOM42');
    }

    engine.activateComebackAbility('ROOM42', 'chaser', 'jammer');
    expect(() => engine.activateComebackAbility('ROOM42', 'chaser', 'timecut')).toThrow('already has an ability');
    const armed = engine.activateComebackAbility('ROOM42', 'other', 'timecut');

    expect(armed.comeback?.queuedJammerPlayerId).toBe('chaser');
    expect(armed.comeback?.queuedTimecutPlayerId).toBe('other');

    const stackedQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 100_000);
    const active = engine.getPublicRoom('ROOM42');
    const leader = active.players.find((player) => player.id === 'leader');

    expect(leader?.hiddenOptionIndexes).toHaveLength(2);
    expect(leader?.reducedQuestionDurationMs).toBe(5_000);
    expect(leader?.reducedQuestionEndsAt).toBe(105_000);
    expect(leader?.timecutActive).toBe(true);
    expect(() => engine.submitAnswer('ROOM42', 'leader', stackedQuestion.correctOptionId, 105_001)).toThrow('deadline');
    expect(engine.submitAnswer('ROOM42', 'chaser', stackedQuestion.correctOptionId, 108_000).isCorrect).toBe(true);
  });

  it('does not reduce leader time below five seconds', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'chaser', playerName: 'Chaser' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    for (let round = 0; round < 3; round += 1) {
      const question = engine.startNextRound('ROOM42', tracks, 8_000, 1000 + round * 20_000);
      engine.submitAnswer('ROOM42', 'leader', question.correctOptionId, 1100 + round * 20_000);
      engine.submitAnswer('ROOM42', 'chaser', question.correctOptionId, 7000 + round * 20_000);
      engine.revealRound('ROOM42');
    }

    engine.activateComebackAbility('ROOM42', 'chaser', 'timecut');
    engine.startNextRound('ROOM42', tracks, 8_000, 100_000);

    const leader = engine.getPublicRoom('ROOM42').players.find((player) => player.id === 'leader');
    expect(leader?.reducedQuestionDurationMs).toBe(5_000);
  });

  it('doubles correct points for the last-place player in Revansh games with at least three players', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'leader', playerName: 'Leader' });
    engine.joinRoom('ROOM42', { playerId: 'middle', playerName: 'Middle' });
    engine.joinRoom('ROOM42', { playerId: 'last', playerName: 'Last' });
    engine.updateSettings('ROOM42', { comebackMode: true });

    const firstQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    engine.submitAnswer('ROOM42', 'leader', firstQuestion.correctOptionId, 1100);
    engine.submitAnswer('ROOM42', 'middle', firstQuestion.correctOptionId, 5000);
    engine.revealRound('ROOM42');

    const comebackQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 30_000);
    const result = engine.submitAnswer('ROOM42', 'last', comebackQuestion.correctOptionId, 32_000);

    expect(result.scoreMultiplier).toBe(2);
    expect(result.scoreNote).toMatch(/^x2,/);
    expect(result.points).toBe(result.basePoints * 2);

    const revealed = engine.revealRound('ROOM42');
    expect(revealed.achievements.some((achievement) => achievement.title === 'Последний, но опасный')).toBe(true);
  });

  it('creates a display room and makes the first joined player host', () => {
    const engine = new GameEngine(() => 'TVROOM');
    const displayRoom = engine.createDisplayRoom();

    expect(displayRoom.code).toBe('TVROOM');
    expect(displayRoom.players).toHaveLength(0);

    const joined = engine.joinRoom('TVROOM', { playerId: 'phone-1', playerName: 'Phone Host' });

    expect(joined.players).toHaveLength(1);
    expect(joined.players[0]).toMatchObject({ id: 'phone-1', isHost: true, connected: true });
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

  it('can show artist names as answer options', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { answerMode: 'artist' });
    const artistTracks: Track[] = [
      { id: 'artist-1', title: 'Song one', artist: 'Artist one', audioUrl: 'https://example.test/1.mp3' },
      { id: 'artist-2', title: 'Song two', artist: 'Artist two', audioUrl: 'https://example.test/2.mp3' },
      { id: 'artist-3', title: 'Song three', artist: 'Artist three', audioUrl: 'https://example.test/3.mp3' },
      { id: 'artist-4', title: 'Song four', artist: 'Artist four', audioUrl: 'https://example.test/4.mp3' }
    ];

    const question = engine.startNextRound('ROOM42', artistTracks, 10_000, 1000);

    expect(question.options).toHaveLength(4);
    expect(question.options.map((option) => option.title).sort()).toEqual(['Artist four', 'Artist one', 'Artist three', 'Artist two']);
  });

  it('can mix artist and song title answer options', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { answerMode: 'mixed' });
    const mixedTracks: Track[] = [
      { id: 'mixed-1', title: 'Song one', artist: 'Artist one', audioUrl: 'https://example.test/1.mp3' },
      { id: 'mixed-2', title: 'Song two', artist: 'Artist two', audioUrl: 'https://example.test/2.mp3' },
      { id: 'mixed-3', title: 'Song three', artist: 'Artist three', audioUrl: 'https://example.test/3.mp3' },
      { id: 'mixed-4', title: 'Song four', artist: 'Artist four', audioUrl: 'https://example.test/4.mp3' }
    ];

    const question = engine.startNextRound('ROOM42', mixedTracks, 10_000, 1000);
    const artistLabels = new Set(mixedTracks.map((track) => track.artist));
    const titleLabels = new Set(mixedTracks.map((track) => track.title));

    expect(question.options).toHaveLength(4);
    expect(question.options.filter((option) => artistLabels.has(option.title))).toHaveLength(2);
    expect(question.options.filter((option) => titleLabels.has(option.title))).toHaveLength(2);
    expect(question.options).toContainEqual({ id: question.correctTrack.id, title: question.correctTrack.title });
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

    expect(hiddenAnswer).toMatchObject({ hasAnswered: true, responseMs: 1000, answerChanges: 0 });
    expect(hiddenAnswer).not.toHaveProperty('optionId');
    expect(hiddenAnswer).not.toHaveProperty('isCorrect');
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

  it('can pause automatic round starts between rounds', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    engine.revealRound('ROOM42');

    const paused = engine.setAutoNextRound('ROOM42', false).settings.autoNextRound;
    const resumed = engine.setAutoNextRound('ROOM42', true).settings.autoNextRound;

    expect(paused).toBe(false);
    expect(resumed).toBe(true);
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

  it('does not count repeated submits of the same option as reselection', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    const first = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);
    const repeated = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 3000);

    expect(repeated).toMatchObject({ answerChanges: 0, responseMs: first.responseMs });
    expect(repeated.answerEvents).toHaveLength(1);
  });

  it('prefers answer options from the same playlist source when possible', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    const sourceUrl = 'https://music.yandex.ru/users/example/playlists/1000';
    const otherSourceUrl = 'https://music.yandex.ru/users/example/playlists/2000';
    const sourceTracks: Track[] = [
      { id: 'source-1', title: 'Correct', artist: 'Artist A', audioUrl: 'https://example.test/1.mp3', sourceUrl },
      { id: 'source-2', title: 'Same two', artist: 'Artist B', audioUrl: 'https://example.test/2.mp3', sourceUrl },
      { id: 'source-3', title: 'Same three', artist: 'Artist C', audioUrl: 'https://example.test/3.mp3', sourceUrl },
      { id: 'source-4', title: 'Same four', artist: 'Artist D', audioUrl: 'https://example.test/4.mp3', sourceUrl }
    ];
    const optionPool = [
      ...sourceTracks,
      { id: 'other-1', title: 'Other one', artist: 'Artist E', sourceUrl: otherSourceUrl },
      { id: 'other-2', title: 'Other two', artist: 'Artist F', sourceUrl: otherSourceUrl },
      { id: 'other-3', title: 'Other three', artist: 'Artist G', sourceUrl: otherSourceUrl }
    ];

    const question = engine.startNextRound('ROOM42', sourceTracks, optionPool, 10_000, 1000);
    const sameSourceIds = new Set(sourceTracks.map((track) => track.id));

    expect(question.options.every((option) => sameSourceIds.has(option.id))).toBe(true);
  });

  it('caps answer change penalties', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const wrongOptions = question.options.filter((option) => option.id !== question.correctOptionId);

    for (let index = 0; index < 6; index += 1) {
      engine.submitAnswer('ROOM42', 'host', wrongOptions[index % wrongOptions.length].id, 2000 + index);
    }
    const corrected = engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 9000);

    expect(corrected.points).toBeGreaterThanOrEqual(100);
  });

  it('publishes live and reveal achievements', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const wrongOption = question.options.find((option) => option.id !== question.correctOptionId)!;

    engine.submitAnswer('ROOM42', 'host', wrongOption.id, 2000);
    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 3000);

    const liveRoom = engine.getPublicRoom('ROOM42');
    const revealed = engine.revealRound('ROOM42');

    expect(liveRoom.achievements.some((achievement) => achievement.id.startsWith('live-first-'))).toBe(true);
    expect(liveRoom.players[0].lastAnswer).toMatchObject({ hasAnswered: true, answerChanges: 1 });
    expect(revealed.achievements.some((achievement) => achievement.title === 'Переобулся удачно')).toBe(true);
  });

  it('publishes live escalation achievements with chain metadata', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const options = question.options.map((option) => option.id);

    for (let index = 0; index < 6; index += 1) {
      engine.submitAnswer('ROOM42', 'host', options[index % options.length], 2000 + index * 100);
    }

    const liveRoom = engine.getPublicRoom('ROOM42');
    const changeChain = liveRoom.achievements.filter((achievement) => achievement.chainId?.includes('answer-changes-host'));

    expect(liveRoom.achievements.length).toBeLessThanOrEqual(8);
    expect(changeChain).toHaveLength(4);
    expect(changeChain.map((achievement) => achievement.chainStep)).toEqual([1, 2, 3, 4]);
  });

  it('detects leaving the correct answer after reveal', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.updateSettings('ROOM42', { allowAnswerChange: true });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const wrongOption = question.options.find((option) => option.id !== question.correctOptionId)!;

    engine.submitAnswer('ROOM42', 'host', question.correctOptionId, 2000);
    engine.submitAnswer('ROOM42', 'host', wrongOption.id, 3000);
    const revealed = engine.revealRound('ROOM42');

    expect(revealed.achievements.some((achievement) => achievement.title === 'Я так и хотел')).toBe(true);
  });

  it('publishes adaptive final match moments in groups of three', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    for (let index = 1; index <= 17; index += 1) {
      engine.joinRoom('ROOM42', { playerId: `p${index}`, playerName: `Player ${index}` });
    }
    engine.updateSettings('ROOM42', { rounds: 1 });
    const question = engine.startNextRound('ROOM42', tracks, 10_000, 1000);

    for (const player of engine.getPublicRoom('ROOM42').players) {
      engine.submitAnswer('ROOM42', player.id, question.correctOptionId, 2000);
    }
    const finalRoom = engine.revealRound('ROOM42');

    expect(finalRoom.status).toBe('finished');
    expect(finalRoom.matchMoments.length).toBeGreaterThan(0);
    expect(finalRoom.matchMoments.length).toBeLessThanOrEqual(12);
    expect(finalRoom.matchMoments.length % 3).toBe(0);
  });

  it('publishes the stolen game moment only when the last round changes the leader', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.joinRoom('ROOM42', { playerId: 'guest', playerName: 'Guest' });
    engine.joinRoom('ROOM42', { playerId: 'third', playerName: 'Third' });
    engine.updateSettings('ROOM42', { rounds: 2 });

    const firstQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const firstWrongOption = firstQuestion.options.find((option) => option.id !== firstQuestion.correctOptionId)!;
    engine.submitAnswer('ROOM42', 'host', firstQuestion.correctOptionId, 3000);
    engine.submitAnswer('ROOM42', 'guest', firstQuestion.correctOptionId, 7000);
    engine.submitAnswer('ROOM42', 'third', firstWrongOption.id, 2500);
    engine.revealRound('ROOM42');

    const finalQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 20_000);
    const finalWrongOption = finalQuestion.options.find((option) => option.id !== finalQuestion.correctOptionId)!;
    engine.submitAnswer('ROOM42', 'guest', finalQuestion.correctOptionId, 21_000);
    engine.submitAnswer('ROOM42', 'host', finalWrongOption.id, 22_000);
    engine.submitAnswer('ROOM42', 'third', finalWrongOption.id, 22_500);
    const finalRoom = engine.revealRound('ROOM42');
    const stealMomentIndex = finalRoom.matchMoments.findIndex((moment) => moment.id === 'moment-steal-guest');

    expect(finalRoom.status).toBe('finished');
    expect(stealMomentIndex).toBe(0);
    expect(finalRoom.matchMoments[stealMomentIndex]).toMatchObject({ recipient: 'Guest', tone: 'rare' });
  });

  it('does not publish the stolen game moment when the winner was already leading before the last round', () => {
    const engine = new GameEngine(() => 'ROOM42');
    engine.createRoom({ playerId: 'host', playerName: 'Host' });
    engine.joinRoom('ROOM42', { playerId: 'guest', playerName: 'Guest' });
    engine.joinRoom('ROOM42', { playerId: 'third', playerName: 'Third' });
    engine.updateSettings('ROOM42', { rounds: 2 });

    const firstQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 1000);
    const firstWrongOption = firstQuestion.options.find((option) => option.id !== firstQuestion.correctOptionId)!;
    engine.submitAnswer('ROOM42', 'host', firstQuestion.correctOptionId, 2000);
    engine.submitAnswer('ROOM42', 'guest', firstQuestion.correctOptionId, 7000);
    engine.submitAnswer('ROOM42', 'third', firstWrongOption.id, 2500);
    engine.revealRound('ROOM42');

    const finalQuestion = engine.startNextRound('ROOM42', tracks, 10_000, 20_000);
    const finalWrongOption = finalQuestion.options.find((option) => option.id !== finalQuestion.correctOptionId)!;
    engine.submitAnswer('ROOM42', 'host', finalQuestion.correctOptionId, 21_000);
    engine.submitAnswer('ROOM42', 'guest', finalWrongOption.id, 22_000);
    engine.submitAnswer('ROOM42', 'third', finalWrongOption.id, 22_500);
    const finalRoom = engine.revealRound('ROOM42');

    expect(finalRoom.status).toBe('finished');
    expect(finalRoom.matchMoments.some((moment) => moment.id.startsWith('moment-steal-'))).toBe(false);
  });
});

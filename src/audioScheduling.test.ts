import { describe, expect, it } from 'vitest';
import { getQuestionAudioSessionKey } from './audioScheduling';

describe('getQuestionAudioSessionKey', () => {
  it('keeps the same audio session when only room server time changes', () => {
    const question = {
      id: 'round-1',
      audioUrl: 'https://example.test/track.mp3',
      startedAt: 1_000
    };

    const firstRoomUpdate = {
      question,
      serverTime: 1_000
    };
    const nextRoomUpdate = {
      question,
      serverTime: 4_000
    };

    expect(getQuestionAudioSessionKey(firstRoomUpdate.question)).toBe(getQuestionAudioSessionKey(nextRoomUpdate.question));
  });
});

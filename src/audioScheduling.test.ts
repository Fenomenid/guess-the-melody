import { describe, expect, it } from 'vitest';
import { getQuestionAudioSessionKey, isSameAudioElementSource } from './audioScheduling';

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

describe('isSameAudioElementSource', () => {
  it('keeps the audio element stable when answer updates do not change the audio URL', () => {
    expect(isSameAudioElementSource('https://example.test/track.mp3', 'https://example.test/track.mp3')).toBe(true);
  });

  it('allows the audio element to update for a different audio URL', () => {
    expect(isSameAudioElementSource('https://example.test/track-1.mp3', 'https://example.test/track-2.mp3')).toBe(false);
  });
});

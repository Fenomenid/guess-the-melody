import { describe, expect, it, vi } from 'vitest';
import {
  createAudioDiagnosticEntry,
  getQuestionAudioSessionKey,
  isSameAudioElementSource,
  resetQuestionAudioElement
} from './audioScheduling';

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

describe('resetQuestionAudioElement', () => {
  it('resets playback without restarting the browser media request', () => {
    const audio = {
      currentTime: 12,
      pause: vi.fn(),
      load: vi.fn()
    };

    resetQuestionAudioElement(audio);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.load).not.toHaveBeenCalled();
  });
});

describe('createAudioDiagnosticEntry', () => {
  it('records readiness and buffering state without exposing the signed audio URL', () => {
    expect(
      createAudioDiagnosticEntry({
        event: 'waiting',
        questionId: 'round-42',
        scheduledStartAt: 10_000,
        now: 10_350,
        audio: {
          currentTime: 1.25,
          readyState: 2,
          networkState: 2,
          paused: false,
          errorCode: null
        }
      })
    ).toEqual({
      event: 'waiting',
      questionId: 'round-42',
      millisecondsFromScheduledStart: 350,
      currentTimeSeconds: 1.25,
      readyState: 2,
      networkState: 2,
      paused: false,
      errorCode: null
    });
  });
});

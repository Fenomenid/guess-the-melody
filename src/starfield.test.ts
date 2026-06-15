import { describe, expect, it } from 'vitest';
import { createStars } from './starfield';

describe('createStars', () => {
  it('creates a stable star map inside the requested field', () => {
    const first = createStars(24, 42);
    const second = createStars(24, 42);

    expect(first).toEqual(second);
    expect(first).toHaveLength(24);
    expect(first.every((star) => star.x >= 0 && star.x < 2000)).toBe(true);
    expect(first.every((star) => star.y >= 0 && star.y < 2000)).toBe(true);
    expect(first.every((star) => star.opacity >= 0.35 && star.opacity <= 1)).toBe(true);
    expect(first.every((star) => star.twinkleDelay >= 0 && star.twinkleDelay < 6)).toBe(true);
  });
});

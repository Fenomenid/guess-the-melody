import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('ranking score actions layout', () => {
  it('reserves content-sized space for multi-digit scores before the kick button', () => {
    expect(styles).toMatch(/\.player-row-actions\s*\{[^}]*grid-template-columns:\s*max-content 22px;/s);
    expect(styles).toMatch(/\.player-row-actions\s*>\s*b\s*\{[^}]*white-space:\s*nowrap;/s);
  });
});

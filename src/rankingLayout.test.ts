import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('ranking score actions layout', () => {
  it('reserves content-sized space for multi-digit scores before the kick button', () => {
    expect(styles).toMatch(/\.player-row-actions\s*\{[^}]*grid-template-columns:\s*max-content 22px;/s);
    expect(styles).toMatch(/\.player-row-actions\s*>\s*b\s*\{[^}]*white-space:\s*nowrap;/s);
  });

  it('keeps the self marker together on one line', () => {
    expect(styles).toMatch(/\.self-mark\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(styles).toMatch(/\.self-mark\s*\{[^}]*flex:\s*0 0 auto;/s);
  });

  it('uses a compact two-column final layout on short desktop screens', () => {
    expect(styles).toMatch(/@media\s*\(max-height:\s*1000px\)\s*and\s*\(min-width:\s*821px\)/s);
    expect(styles).toMatch(/\.final-summary-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(320px,\s*1\.1fr\);/s);
    expect(styles).toMatch(/\.final-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  });

  it('uses the free desktop width for result screens', () => {
    expect(styles).toMatch(/\.page\.result-page\s*\{[^}]*width:\s*min\(1560px,\s*100%\);/s);
    expect(styles).toMatch(/\.result-page\s+\.layout\s*\{[^}]*grid-template-columns:\s*280px\s+minmax\(0,\s*1fr\);/s);
    expect(styles).toMatch(/\.round-result-grid\s*\{[^}]*grid-template-columns:\s*minmax\(360px,\s*0\.9fr\)\s+minmax\(460px,\s*1\.1fr\);/s);
  });

  it('keeps every ranking tile and metric position stable', () => {
    expect(styles).toMatch(/\.player-row\s*\{[^}]*height:\s*104px;[^}]*grid-template-columns:\s*38px\s+minmax\(0,\s*1fr\)\s+max-content;/s);
    expect(styles).toMatch(/\.player-row-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+58px;/s);
    expect(styles).toMatch(/\.player-rank-slot\s*\{[^}]*width:\s*58px;/s);
    expect(styles).toMatch(/\.player-effect-slot\s*\{[^}]*overflow:\s*hidden;/s);
  });
});

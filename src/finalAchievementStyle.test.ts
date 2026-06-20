import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('final achievement visual style', () => {
  it('uses the shared dark surface with tone accents and an entrance animation', () => {
    expect(styles).toMatch(/\.final-insights\s+\.achievement-card\s*\{[^}]*--moment-accent:[^}]*background:[^}]*var\(--surface-2\)[^}]*animation:\s*final-achievement-in/s);
    expect(styles).toMatch(/\.final-insights\s+\.achievement-card::before\s*\{[^}]*background:\s*var\(--moment-accent\);/s);
    expect(styles).toMatch(/\.final-insights\s+\.achievement-card\.good\s*\{[^}]*--moment-accent:\s*var\(--success\);/s);
    expect(styles).toMatch(/@keyframes\s+final-achievement-in/s);
  });

  it('uses the same layered dark visual language for the podium', () => {
    expect(styles).toMatch(/\.podium-place\s*\{[^}]*--podium-accent:[^}]*background:[^}]*var\(--surface-2\)/s);
    expect(styles).toMatch(/\.podium-place::before\s*\{[^}]*background:\s*var\(--podium-accent\);/s);
    expect(styles).toMatch(/\.place-1\s*\{[^}]*--podium-accent:\s*var\(--gold\);/s);
    expect(styles).toMatch(/\.place-2\s*\{[^}]*--podium-accent:\s*var\(--accent-strong\);/s);
  });
});

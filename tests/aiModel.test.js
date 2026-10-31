// The Node.js moderation model must give exactly the results of the original Python implementation.
// Reference cases (every dataset text, the probe set and edge cases) come from ai-moderation/training/export_node.py.
import { readFileSync } from 'node:fs';
import { createModerator } from '../src/ai/moderation/moderator.js';

const { cases } = JSON.parse(readFileSync(new URL('../ai-moderation/evaluation/parity_cases.json', import.meta.url), 'utf8'));
const moderator = createModerator();
const FIELDS = ['decision', 'category', 'severity', 'confidence', 'language_code', 'detected_language', 'explanation', 'flagged_terms'];

test(`${cases.length} reference cases: same decision, category, language, flagged positions and probabilities as Python`, () => {
  const mismatches = [];
  let maxDiff = 0;
  for (const expected of cases) {
    const actual = moderator.moderate(expected.text);
    for (const field of FIELDS) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field])) mismatches.push({ text: expected.text, field });
    }
    for (const [label, p] of Object.entries(expected.probabilities || {})) maxDiff = Math.max(maxDiff, Math.abs(p - actual.probabilities[label]));
  }
  expect(mismatches).toEqual([]);
  expect(maxDiff).toBeLessThan(1e-9);
});

test('uses the thresholds tuned on validation data', () => {
  expect(moderator.thresholds).toEqual({ block: 0.6, uncertain: 0.5 });
  expect(moderator.version).toMatch(/^baseline-/);
});

test('flagged positions are UTF-16 indices that highlight the exact words (emoji before the word)', () => {
  const text = '😀😀 you are a b1tch 😀';
  const { flagged_terms: flagged } = moderator.moderate(text);
  expect(flagged.length).toBeGreaterThan(0);
  for (const f of flagged) expect(text.slice(f.start, f.end)).toBe(f.text);
});

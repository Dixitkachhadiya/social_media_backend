/**
 * Proves that the Node.js moderation model gives the same results as the original Python implementation.
 *
 *   node scripts/check-moderation-parity.js [path/to/parity_cases.json]
 *
 * Reference cases are produced by ai-moderation/training/export_node.py (every dataset text, the probe set
 * and edge cases, each with Python's probabilities, decision, category, flagged positions and language).
 * Exits with code 1 on any mismatch.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createModerator } from '../src/ai/moderation/moderator.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.argv[2] || path.join(root, 'ai-moderation', 'evaluation', 'parity_cases.json');
const { cases } = JSON.parse(readFileSync(file, 'utf8'));
const moderator = createModerator();

const FIELDS = ['decision', 'category', 'severity', 'confidence', 'language_code', 'detected_language', 'explanation'];
const mismatches = [];
let maxProbDiff = 0;
const started = performance.now();

for (const expected of cases) {
  const actual = moderator.moderate(expected.text);
  const problems = FIELDS.filter((f) => actual[f] !== expected[f]).map((f) => `${f}: python=${JSON.stringify(expected[f])} node=${JSON.stringify(actual[f])}`);
  if (JSON.stringify(actual.flagged_terms) !== JSON.stringify(expected.flagged_terms)) {
    problems.push(`flagged_terms: python=${JSON.stringify(expected.flagged_terms)} node=${JSON.stringify(actual.flagged_terms)}`);
  }
  if (expected.probabilities) {
    for (const [label, p] of Object.entries(expected.probabilities)) {
      maxProbDiff = Math.max(maxProbDiff, Math.abs(p - actual.probabilities[label]));
    }
  }
  if (problems.length) mismatches.push({ text: expected.text, problems });
}

const ms = performance.now() - started;
console.log(`Cases: ${cases.length}`);
console.log(`Max probability difference: ${maxProbDiff.toExponential(2)}`);
console.log(`Mismatches (decision, category, severity, confidence, language, explanation, flagged terms): ${mismatches.length}`);
console.log(`Node time: ${ms.toFixed(0)} ms total, ${(ms / cases.length).toFixed(2)} ms per text`);
for (const m of mismatches.slice(0, 20)) console.log(`- ${JSON.stringify(m.text)}\n    ${m.problems.join('\n    ')}`);
process.exit(mismatches.length || maxProbDiff > 1e-9 ? 1 : 0);

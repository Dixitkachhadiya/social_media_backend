// Evaluates the DEPLOYED Node moderation engine (word list + classifier + severity policy) on the
// hand-written probe set (training/probe_set.json), which is never used for training.
// Usage (from Backend/): node ai-content-moderation/scripts/evaluate_probe.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { moderateText } from '../../src/moderation/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { examples } = JSON.parse(fs.readFileSync(path.join(root, 'training/probe_set.json'), 'utf8'));

const rows = examples.map((e) => {
  const r = moderateText(e.text);
  return { ...e, predicted: r.category, action: r.action, flagged: r.is_inappropriate, p: r.model.p_inappropriate, signals: r.signals };
});

const truth = (r) => r.category !== 'clean';
const tp = rows.filter((r) => truth(r) && r.flagged).length;
const fp = rows.filter((r) => !truth(r) && r.flagged).length;
const fn = rows.filter((r) => truth(r) && !r.flagged).length;
const tn = rows.filter((r) => !truth(r) && !r.flagged).length;
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
const f1 = (2 * precision * recall) / (precision + recall || 1);
const blockedClean = rows.filter((r) => !truth(r) && ['review', 'block'].includes(r.action)).length;
const categoryCorrect = rows.filter((r) => truth(r) && r.predicted === r.category).length;
const pct = (x) => `${(100 * x).toFixed(1)}%`;

const lines = [
  '# Probe set evaluation (deployed engine)',
  '',
  `Generated ${new Date().toISOString()} by \`scripts/evaluate_probe.mjs\`.`,
  '',
  `${rows.length} hand-written sentences (${rows.filter((r) => !truth(r)).length} clean, ${rows.filter(truth).length} inappropriate) that are not generated from the dataset templates and were never used for training. This is a small sanity check, not a benchmark.`,
  '',
  '| Metric | Value |',
  '|---|---|',
  `| Accuracy | ${pct((tp + tn) / rows.length)} |`,
  `| Precision | ${pct(precision)} |`,
  `| Recall | ${pct(recall)} |`,
  `| F1 | ${pct(f1)} |`,
  `| Confusion matrix (clean→clean, clean→flagged, bad→clean, bad→flagged) | ${tn}, ${fp}, ${fn}, ${tp} |`,
  `| Clean posts that would be **refused** (review/block) | ${blockedClean} |`,
  `| Correct category among detected inappropriate | ${categoryCorrect}/${tp} |`,
  '',
  '| Text | Lang | Expected | Predicted | Action | p(model) | Signals |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.text.replace(/\|/g, '/')} | ${r.lang} | ${r.category} | ${r.predicted} | ${r.action} | ${r.p} | ${r.signals.join('+') || '-'} |`),
];
fs.writeFileSync(path.join(root, 'models/probe_report.md'), `${lines.join('\n')}\n`);
console.log(`Probe set: n=${rows.length} accuracy=${pct((tp + tn) / rows.length)} precision=${pct(precision)} recall=${pct(recall)} F1=${pct(f1)} | FP=${fp} FN=${fn} | clean refused=${blockedClean}`);
for (const r of rows.filter((x) => truth(x) !== x.flagged)) {
  console.log(`  ${truth(r) ? 'MISSED ' : 'FALSE+ '} [${r.lang}] ${r.text} -> ${r.predicted}/${r.action} p=${r.p}`);
}

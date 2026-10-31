/**
 * Evaluates the local AI features and prints measured results (nothing here is estimated):
 *   1. Moderation, Python vs Node.js on the same held-out test split (ai-moderation/evaluation/test_split_python.json)
 *   2. Moderation, hand-written category matrix (sentences not in the dataset)
 *   3. Summarization cases
 *   4. Memory and latency of the in-process models
 *
 *   node --expose-gc scripts/evaluate-ai.js
 *
 * Note: the deployed configuration uses the FULL word list, which includes words from the test split, so
 * section 1 is optimistic. The leakage-free numbers are in ai-moderation/evaluation/report.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

global.gc?.();
const memBefore = process.memoryUsage();
const loadStarted = performance.now();
const { createModerator } = await import('../src/ai/moderation/moderator.js');
const moderator = createModerator();
moderator.moderate('warm up');
const loadMs = performance.now() - loadStarted;
global.gc?.();
const memAfter = process.memoryUsage();
const { summarizeText, summarizeDiscussion } = await import('../src/ai/summarization/summarizer.js');

// ---------- 1. Python vs Node on the test split ----------

const metrics = (rows, flaggedOf) => {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  for (const r of rows) {
    const toxic = r.label !== 'CLEAN';
    const flagged = flaggedOf(r);
    if (toxic && flagged) tp += 1; else if (toxic) fn += 1; else if (flagged) fp += 1; else tn += 1;
  }
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  return {
    n: rows.length, accuracy: (tp + tn) / rows.length, precision, recall,
    f1: (2 * precision * recall) / (precision + recall || 1), fpr: fp / (fp + tn || 1), fnr: fn / (fn + tp || 1), tp, fp, tn, fn,
  };
};
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const row = (name, m) => `| ${name} | ${m.n} | ${pct(m.accuracy)} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${pct(m.fpr)} | ${pct(m.fnr)} |`;
const HEADER = '| | n | Accuracy | Precision | Recall | F1 | False-positive rate | False-negative rate |\n|---|---|---|---|---|---|---|---|';

const { rows } = JSON.parse(readFileSync(path.join(root, 'ai-moderation', 'evaluation', 'test_split_python.json'), 'utf8'));
const sentences = rows.filter((r) => !r.single_word);
for (const r of sentences) r.node = moderator.moderate(r.text);
const disagreements = sentences.filter((r) => r.node.decision !== r.python_decision || r.node.category !== r.python_category).length;

console.log('## 1. Moderation: Python vs Node.js, held-out test split (sentences and paragraphs)\n');
console.log(HEADER);
console.log(row('Python (original service)', metrics(sentences, (r) => r.python_decision !== 'allow')));
console.log(row('Node.js (in-process)', metrics(sentences, (r) => r.node.decision !== 'allow')));
console.log(`\nDecision/category disagreements between Python and Node.js: ${disagreements} of ${sentences.length}\n`);
console.log('Per language (Node.js):\n');
console.log(HEADER.replace('| |', '| Language |'));
for (const lang of [...new Set(sentences.map((r) => r.language_code))].sort()) {
  const subset = sentences.filter((r) => r.language_code === lang);
  if (subset.length < 10) console.log(`| ${lang} | ${subset.length} | too few examples | | | | | |`);
  else console.log(row(lang, metrics(subset, (r) => r.node.decision !== 'allow')));
}

// ---------- 2. Category matrix ----------

const MATRIX = [
  ['Clean English', 'CLEAN', 'Just finished reading a great book about space exploration, highly recommend it.'],
  ['Clean English', 'CLEAN', 'Our team won the cricket match yesterday, everyone played really well.'],
  ['Vulgar English', 'VULGAR', 'This fucking exam ruined my whole week.'],
  ['Vulgar English', 'VULGAR', 'What a shitty day, nothing worked.'],
  ['Hindi vulgar', 'VULGAR', 'ये क्या बकवास है, साला हरामी सिस्टम।'],
  ['Hindi vulgar', 'PERSONAL_ABUSE', 'तू पूरा कमीना है।'],
  ['Gujarati vulgar', 'PERSONAL_ABUSE', 'તું સાવ નાલાયક માણસ છે.'],
  ['Gujarati vulgar', 'VULGAR', 'આ ગંદી ગાળો બંધ કર, હરામી.'],
  ['Hinglish', 'PERSONAL_ABUSE', 'Bhai tu sach mein chutiya hai, kuch bhi bolta hai.'],
  ['Hinglish', 'CLEAN', 'Bhai kal ka match dekha? Kya shot mara Kohli ne!'],
  ['Hindi transliteration', 'VULGAR', 'Madarchod log hai sab yahan.'],
  ['Hindi transliteration', 'CLEAN', 'Aaj bahut garmi hai, ghar pe hi rehna chahiye.'],
  ['Gujarati transliteration', 'PERSONAL_ABUSE', 'Tu ekdam gadhedo che, kai samajto nathi.'],
  ['Gujarati transliteration', 'CLEAN', 'Kem cho? Aaje saanje garba ma aavsho ne?'],
  ['Mixed language', 'PERSONAL_ABUSE', 'Yaar this guy is such a chutiya, તું પણ જોજે.'],
  ['Mixed language', 'CLEAN', 'Weekend plan: Ahmedabad ma street food, phir movie dekhenge.'],
  ['Personal abuse', 'PERSONAL_ABUSE', 'You are a worthless idiot and everyone knows it.'],
  ['Personal abuse', 'PERSONAL_ABUSE', 'Shut up you stupid moron.'],
  ['Harassment', 'HARASSMENT', 'Nobody wants you here, just disappear forever.'],
  ['Harassment', 'HARASSMENT', 'Go kill yourself, loser.'],
  ['Hate speech', 'HATE_SPEECH', 'People from that community are vermin and should be thrown out.'],
  ['Hate speech', 'HATE_SPEECH', 'All immigrants are filthy animals.'],
  ['Threat', 'THREAT', 'I will find where you live and break your legs.'],
  ['Threat', 'THREAT', 'Kal mil, jaan se maar dunga tujhe.'],
  ['Ordinary criticism', 'CLEAN', 'The new update is terrible, the app crashes every time I open it.'],
  ['Ordinary criticism', 'CLEAN', 'I strongly disagree with this policy, it hurts small businesses.'],
  ['Ordinary criticism', 'CLEAN', 'The movie was boring and way too long.'],
  ['Harmless joke', 'CLEAN', 'My code works and I have no idea why, send help 😂'],
  ['Harmless joke', 'CLEAN', 'I told my plants a joke, now they are rolling on the floor. Plant puns are the root of all evil.'],
  ['Harmless joke', 'CLEAN', 'Monday ko dekh ke meri neend bhaag jaati hai 😂'],
];

console.log('\n## 2. Moderation: category matrix (hand-written, not in the dataset)\n');
console.log('| Case | Text | Expected | Decision | Category | Flagged | Correct? |\n|---|---|---|---|---|---|---|');
let correctBlock = 0; let correctCategory = 0;
for (const [name, expected, text] of MATRIX) {
  const r = moderator.moderate(text);
  const okBlock = (expected === 'CLEAN') === (r.decision === 'allow');
  const okCategory = okBlock && (expected === 'CLEAN' || r.category === expected);
  correctBlock += okBlock; correctCategory += okCategory;
  const flagged = r.flagged_terms.map((f) => f.text).join(', ') || '-';
  console.log(`| ${name} | ${text} | ${expected} | ${r.decision} | ${r.category} | ${flagged} | ${okBlock ? (okCategory ? 'yes' : 'blocked, other category') : 'NO'} |`);
}
console.log(`\nAllow/block correct: ${correctBlock}/${MATRIX.length}; allow/block and category correct: ${correctCategory}/${MATRIX.length}`);

// ---------- 3. Summarization ----------

const TEXTS = [
  ['Short text', 'medium', 'Nice weather today. Loving it!'],
  ['Empty input', 'medium', ''],
  ['Long English text', 'medium', 'Our city finally opened the new metro line last week. The line connects the airport to the main business district in just 25 minutes. Ticket prices start at 30 rupees, which is cheaper than a taxi. Some commuters complained that the stations are still missing escalators. The transport department says escalators will be installed by March. Overall, most riders I spoke to are happy with the faster commute. I took it twice and the trains were clean and on time.'],
  ['Multiple paragraphs', 'short', 'I started learning guitar three months ago.\n\nAt first my fingers hurt and I could barely play a chord. I practiced fifteen minutes every day, even when I was tired.\n\nNow I can play five songs from start to finish. The biggest lesson: small daily practice beats long weekend sessions.'],
  ['Hindi', 'short', 'आज शहर में नई मेट्रो लाइन शुरू हुई। यह लाइन हवाई अड्डे को बाजार से जोड़ती है। टिकट की कीमत तीस रुपये से शुरू होती है। कुछ यात्रियों ने कहा कि स्टेशनों पर अभी लिफ्ट नहीं है। ज़्यादातर लोग तेज़ सफर से खुश हैं।'],
  ['Gujarati', 'short', 'આજે શહેરમાં નવી મેટ્રો લાઇન શરૂ થઈ. આ લાઇન એરપોર્ટને બજાર સાથે જોડે છે. ટિકિટની કિંમત ત્રીસ રૂપિયાથી શરૂ થાય છે. કેટલાક મુસાફરોએ કહ્યું કે સ્ટેશન પર હજી લિફ્ટ નથી.'],
  ['Mixed language (Hinglish)', 'short', 'Kal hum log Lonavala trip pe gaye the. Weather ekdum mast tha aur baarish bhi ho rahi thi. Raste mein traffic bahut zyada tha, almost 3 ghante lag gaye. Wahan pahunch ke vada pav aur chai ka maza liya. Next time hum early morning nikalenge taaki traffic na mile.'],
];

console.log('\n## 3. Summarization\n');
for (const [name, length, text] of TEXTS) {
  const started = performance.now();
  const r = text.trim() ? summarizeText(text, length) : { empty: true };
  const ms = (performance.now() - started).toFixed(1);
  const verbatim = r.summary ? r.summary.split(/(?<=[.!?।])\s+/).every((s) => text.includes(s)) : null;
  console.log(`### ${name} (${length}, ${ms} ms)`);
  if (r.empty) console.log('-> rejected by the API validator (400: content is required)');
  else if (r.tooShort) console.log('-> 422 TEXT_TOO_SHORT');
  else console.log(`-> ${r.sentences_selected}/${r.sentences_total} sentences, ${r.summary.length}/${text.length} characters, verbatim: ${verbatim}\n   ${r.summary.replace(/\n/g, ' ')}`);
}

const discussion = summarizeDiscussion({
  post: { author: 'asha', content: 'Should our college make attendance optional for final-year students? I think it would help students focus on internships.' },
  comments: [
    { author: 'ravi', content: 'Yes! Internships matter more in the final year than lectures.' },
    { author: 'meera', content: 'Optional attendance could hurt students who need structure. Many people skip and then fail exams.' },
    { author: 'john', content: 'Nice post' },
    { author: 'ravi', content: 'Maybe make it optional only for students with an internship offer letter.' },
    { author: 'kiran', content: 'Agree with Meera, structure helps. But internships are important too.' },
    { author: 'zoya', content: 'lol' },
  ],
});
console.log('\n### Post with comments (social media discussion)\n```\n' + discussion.summary + '\n```');

// Worst case input sizes
const long = Array.from({ length: 120 }, (_, i) => `Sentence ${i} talks about topic ${i % 9} and detail ${i}.`).join(' ').slice(0, 5000);
let t = performance.now();
summarizeText(long, 'detailed');
const longMs = performance.now() - t;
const manyComments = Array.from({ length: 100 }, (_, i) => ({ author: `user${i % 30}`, content: `Comment ${i} says the plan for topic ${i % 11} is ${i % 2 ? 'good' : 'risky'} because of reason ${i}. `.repeat(8).slice(0, 1000) }));
t = performance.now();
summarizeDiscussion({ post: { author: 'a', content: 'What do you think about the plan?' }, comments: manyComments });
const discMs = performance.now() - t;

// ---------- 4. Memory and latency ----------

const timings = [];
for (const r of sentences) {
  const s = performance.now();
  moderator.moderate(r.text);
  timings.push(performance.now() - s);
}
timings.sort((a, b) => a - b);
t = performance.now();
moderator.moderate('word '.repeat(1000).slice(0, 5000));
const maxPostMs = performance.now() - t;

console.log('\n## 4. Memory and latency (this machine)\n');
console.log(`- Moderation model load + warm-up: ${loadMs.toFixed(0)} ms`);
console.log(`- Memory added by the moderation model: heap ${mb(memAfter.heapUsed - memBefore.heapUsed)}, RSS ${mb(memAfter.rss - memBefore.rss)}`);
console.log(`- Process RSS after loading (this script): ${mb(memAfter.rss)}`);
console.log(`- Moderation latency per text: median ${timings[Math.floor(timings.length / 2)].toFixed(2)} ms, p95 ${timings[Math.floor(timings.length * 0.95)].toFixed(2)} ms, 5000-character post ${maxPostMs.toFixed(1)} ms`);
console.log(`- Summarization: 5000-character text ${longMs.toFixed(1)} ms; discussion with 100 comments x 1000 characters ${discMs.toFixed(1)} ms`);

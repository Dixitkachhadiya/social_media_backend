/**
 * Checks the real Ollama setup end to end and prints measured results (no database needed):
 *
 *   npm run ai:check
 *
 * 1. the Ollama server is reachable and OLLAMA_MODEL is pulled
 * 2. moderation of sample texts in English, Hindi, Gujarati and Hinglish (with suggestions)
 * 3. a summary and a generated post
 * Exits with code 1 if Ollama is not ready or a moderation sample gets the wrong allow/block decision.
 */
import 'dotenv/config';
import { listModels, ollamaConfig, ollamaHealth } from '../src/services/ollamaService.js';
import { checkContent } from '../src/services/moderationService.js';
import { summarizeText } from '../src/services/summarizationService.js';
import { generatePost } from '../src/services/aiWritingService.js';

const { baseUrl, model } = ollamaConfig();
console.log(`Ollama: ${baseUrl}  model: ${model || '(OLLAMA_MODEL not set)'}`);
const health = await ollamaHealth();
if (!health.available) {
  console.error(`Not ready (${health.status}): ${health.detail}`);
  try {
    console.error(`Models on this server: ${(await listModels()).join(', ') || 'none'}`);
  } catch {
    /* unreachable: already reported */
  }
  process.exit(1);
}

// [expected allowed?, text]
const SAMPLES = [
  [true, 'Had a great time at the conference today, learned a lot!'],
  [true, 'The new update is terrible, the app crashes every time I open it.'],
  [true, 'My code works and I have no idea why 😂'],
  [true, 'Bhai kal ka match dekha? Kya shot mara Kohli ne!'],
  [true, 'આજે વરસાદ પડ્યો, મોસમ સરસ છે.'],
  [false, 'I hate this stupid person. He is an idiot.'],
  [false, 'This fucking traffic made me late again.'],
  [false, 'तू एकदम कमीना है, सब खराब कर दिया।'],
  [false, 'તું સાવ નાલાયક છે, કામ બગાડી નાખ્યું.'],
  [false, 'Tu sach mein chutiya hai yaar'],
  [false, 'Kal college ke bahar mil, jaan se maar dunga'],
  [false, 'People of that religion are vermin and should be thrown out.'],
];

let wrong = 0;
const times = [];
for (const [expectedAllowed, text] of SAMPLES) {
  const started = Date.now();
  try {
    const r = await checkContent(text);
    times.push(Date.now() - started);
    const ok = r.allowed === expectedAllowed;
    wrong += ok ? 0 : 1;
    console.log(`\n[${ok ? 'OK' : 'WRONG'}] ${(Date.now() - started) / 1000}s  ${r.allowed ? 'allowed' : `blocked: ${r.category}`}  (${r.detected_language})\n  text:       ${text}`);
    if (!r.allowed) {
      console.log(`  flagged:    ${r.flagged_words.join(', ') || '(none located in the text)'}\n  reason:     ${r.explanation}\n  suggestion: ${r.suggested_text ?? '(none)'}`);
    }
  } catch (error) {
    wrong += 1;
    console.log(`\n[ERROR] ${text}\n  ${error.statusCode} ${error.message}`);
  }
}

const article = 'Our city finally opened the new metro line last week. The line connects the airport to the main business district in just 25 minutes. Ticket prices start at 30 rupees, which is cheaper than a taxi. Some commuters complained that the stations are still missing escalators. The transport department says escalators will be installed by March.';
let started = Date.now();
const summary = await summarizeText({ content: article, length: 'short' });
console.log(`\nSummary (${((Date.now() - started) / 1000).toFixed(1)}s): ${summary}`);
started = Date.now();
const post = await generatePost({ topic: 'Importance of learning programming', tone: 'friendly' });
console.log(`\nGenerated post (${((Date.now() - started) / 1000).toFixed(1)}s):\n${post}`);

times.sort((a, b) => a - b);
console.log(`\nModeration: ${SAMPLES.length - wrong}/${SAMPLES.length} correct allow/block decisions; median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)}s per text`);
process.exit(wrong ? 1 : 0);

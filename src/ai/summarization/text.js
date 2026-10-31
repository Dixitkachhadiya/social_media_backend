/**
 * Language-independent text helpers for extractive summarization: sentence splitting (ICU, so the Hindi
 * danda "।" and Gujarati text are handled) and content-word tokens for sentence similarity.
 */

const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
// "Mr. Smith", "e.g. this": ICU breaks after these, so the next segment is merged back
const ABBREVIATION = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|fig|approx|e\.g|i\.e|[a-z])\.\s*$/i;
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const LATIN = /^[a-z]/;

// Function words of English, Hindi/Hinglish (both scripts) and Gujarati (both scripts): they carry little
// meaning, so sentences are compared by their remaining content words
const STOPWORDS = new Set(`
a an the and or but if then so than that this these those there here is are was were be been being am do does did
have has had i me my we our you your he him his she her it its they them their what which who whom when where why how
to of in on at by for with from as into about over after before under again further just also very can will would should
could may might must not no yes too only own same such more most other some any each few all both up down out off s t
don im ive id youre its thats dont isnt cant wont didnt doesnt ok okay
hai hain tha thi the ho hoga hogi kya ki ka ke ko se me mein par pe aur ya bhi to toh hi na nahi nahin mat ye yeh wo woh
is us ek kuch koi sab jo jab tab kar karo kiya raha rahi rahe gaya gayi diya liya bas abhi phir yaar ji haan
और का की के को से में पर है हैं था थी थे हो भी तो ही न नहीं यह वह ये वो इस उस एक कुछ कोई सब जो जब तब कर किया रहा रही गया
che chhe chu nathi ane pan ma mate thi nu ni no na ne e aa te je ke to ja hatu hati hato thay thai kai kem shu
અને છે છું નથી પણ માં માટે થી નું ની નો ના ને એ આ તે જે કે તો જ હતું હતી હતો થાય કઈ કેમ શું
`.split(/\s+/).filter(Boolean));

/** Splits text into sentences: [{ text, words }] in original order (line breaks always end a sentence). */
export const splitSentences = (text) => {
  const sentences = [];
  for (const line of text.split(/\n+/)) {
    let pending = '';
    for (const { segment } of segmenter.segment(line)) {
      pending += segment;
      if (ABBREVIATION.test(pending)) continue;
      const trimmed = pending.trim();
      if (trimmed) sentences.push(trimmed);
      pending = '';
    }
    if (pending.trim()) sentences.push(pending.trim());
  }
  return sentences.map((s) => ({ text: s, words: countWords(s) }));
};

export const countWords = (text) => (text.match(WORD) || []).length;

// Long Latin words are cut to 6 letters, a cheap multilingual stand-in for stemming
// (discussion/discussed, dekhni/dekhna); Devanagari and Gujarati words are kept whole
const stem = (word) => (LATIN.test(word) && word.length > 6 ? word.slice(0, 6) : word);

/** Content-word tokens used to compare sentences. */
export const contentTokens = (text) =>
  (text.normalize('NFKC').toLowerCase().match(WORD) || []).filter((w) => !STOPWORDS.has(w) && w.length > 1).map(stem);

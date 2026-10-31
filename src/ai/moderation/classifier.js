import { readFileSync } from 'node:fs';

/**
 * The trained moderation classifier (TF-IDF over character 2-5-grams within word boundaries + multinomial
 * logistic regression), evaluated in plain JavaScript from the parameters exported by
 * ai-moderation/training/export_node.py. Reproduces scikit-learn's predict_proba:
 *
 *   char_wb n-grams of each word padded with spaces -> counts -> 1 + ln(count) -> x idf -> L2 normalize
 *   -> scores = coef . x + intercept -> softmax
 *
 * Input must already be normalized (preprocessing/normalize.js), exactly as during training.
 */

const FORMAT = 'tfidf-char_wb-logreg/v1';

// sklearn TfidfVectorizer(analyzer="char_wb"): n-grams of " word ", a word shorter than n counted once
const charWbNgrams = (text, minN, maxN, onNgram) => {
  for (const word of text.split(' ')) {
    if (!word) continue;
    const chars = Array.from(` ${word} `); // code points, like Python string slicing
    for (let n = minN; n <= maxN; n += 1) {
      let offset = 0;
      onNgram(chars.slice(offset, offset + n).join(''));
      while (offset + n < chars.length) {
        offset += 1;
        onNgram(chars.slice(offset, offset + n).join(''));
      }
      if (offset === 0) break;
    }
  }
};

export const loadClassifier = (file) => {
  const model = JSON.parse(readFileSync(file, 'utf8'));
  if (model.format !== FORMAT) throw new Error(`Unsupported classifier format: ${model.format}`);
  const { labels, vocabulary, idf, coef, intercept } = model;
  const nFeatures = vocabulary.length;
  if (idf.length !== nFeatures || coef.length !== labels.length || coef.some((row) => row.length !== nFeatures)) {
    throw new Error('Classifier file is inconsistent (vocabulary, idf and coefficients differ in size)');
  }

  const index = new Map(vocabulary.map((ngram, i) => [ngram, i]));
  const idfValues = Float64Array.from(idf);
  const weights = coef.map((row) => Float64Array.from(row));
  const [minN, maxN] = model.ngram_range;

  /** { label: probability } for one normalized text. */
  const predictProba = (normalized) => {
    const counts = new Map();
    charWbNgrams(normalized, minN, maxN, (ngram) => {
      const i = index.get(ngram);
      if (i !== undefined) counts.set(i, (counts.get(i) || 0) + 1);
    });

    const features = [];
    let norm = 0;
    for (const [i, count] of counts) {
      const value = (model.sublinear_tf ? 1 + Math.log(count) : count) * idfValues[i];
      features.push([i, value]);
      norm += value * value;
    }
    norm = Math.sqrt(norm) || 1;

    const scores = weights.map((row, c) => {
      let s = intercept[c];
      for (const [i, value] of features) s += row[i] * (value / norm);
      return s;
    });
    const max = Math.max(...scores);
    const exp = scores.map((s) => Math.exp(s - max));
    const total = exp.reduce((a, b) => a + b, 0);
    return Object.fromEntries(labels.map((label, c) => [label, exp[c] / total]));
  };

  return { name: model.name, labels, nFeatures, predictProba };
};

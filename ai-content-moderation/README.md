# Multilingual content moderation

Detects vulgar, abusive, harassing, threatening and hateful language in English, Hindi, Gujarati, Hinglish,
romanized Hindi/Gujarati and mixed-language text. It powers the backend's **AI Content Assistant**
(`/api/ai/moderate-content`, `/rewrite-content`, `/check-and-rewrite`) and the moderation that runs on
every post create/edit.

> **Status: development prototype.** The model is trained on a small **synthetic** dataset. It catches
> common abuse and obfuscation but will miss slang it has never seen and occasionally warns on harmless
> posts. Read [`models/evaluation_report.md`](models/evaluation_report.md) and
> [`models/probe_report.md`](models/probe_report.md) before relying on it, and have native speakers
> review the Hindi/Gujarati word list.

## How it works

```
text ──► normalize (NFKC, leet 0→o 1→i @→a…, f*ck, f u c k, fuuuck, zero-width chars)
     ├─► word/phrase list (lexicon.json)        reliable, gives highlight positions + replacements
     └─► char n-gram classifier (model.json)    catches unlisted abuse, threats, hate; gives probabilities
                │
                ▼
     severity policy (Backend/src/moderation/engine.js)
       none → allow · low → warn · medium → review (rewrite required) · high → block
```

- **Inference runs inside Node.js** (`Backend/src/moderation/`). Python is only needed to build the
  dataset and retrain. There is no separate service to run, and moderation keeps working without an AI provider.
- **Model:** TF-IDF over character 2–5-grams within word boundaries (`char_wb`), then multinomial logistic
  regression with 6 classes: `clean, profanity, insult, harassment, threat, hate`. Character n-grams are robust
  to transliteration, misspelling and code-mixing, and train in seconds on a CPU. A multilingual transformer
  was considered but rejected for now: there's no GPU, only 7.7 GB of RAM, and the dataset is too small and
  synthetic for fine-tuning to be meaningful.
- **Word list:** the `Vulgar Words` sheet. Context-dependent words (*kutta* "dog", *saala*, *ullu* "owl",
  *gadhedo* "donkey") only count when the text addresses someone ("tu", "you", "tame"…) or the classifier
  is confident. Masked words such as `s*it` or `d1ck*ead` match through a wildcard.
- **Safety rules:**
  - A classifier score alone never blocks. Without a word-list hit it gives at most a warning, or a
    "review" for a confident threat/hate/harassment prediction on 5+ words.
  - Texts under 3 words are judged by the word list only.
  - Threats and hate are their own categories with `high` severity, not "profanity".
- **Parity:** `training/text_normalization.py` and `Backend/src/moderation/normalize.js` must produce
  identical output. `train.py` writes `models/parity_fixtures.json`, and the Jest suite checks that Node
  reproduces Python's normalization and probabilities (difference < 1e-5).

## Layout

```
ai-content-moderation/
  datasets/
    multilingual_content_moderation_dataset.xlsx   synthetic dataset (5 sheets)
    README.md                                      limitations, labelling guide, adding reviewed data
  scripts/
    generate_dataset.py                            builds the workbook from templates (seeded)
    evaluate_probe.mjs                             scores the DEPLOYED Node engine on the probe set
  training/
    text_normalization.py                          normalization (mirrored in Node)
    lexicon.py                                     word-list matching (mirrored in Node)
    train.py                                       train, evaluate, export
    probe_set.json                                 hand-written sentences never used for training
  models/                                          generated artifacts (used by the backend)
    moderation_model.json  lexicon.json  parity_fixtures.json
    evaluation_report.md/.json  probe_report.md
  requirements.txt
```

## Setup (Python 3.11+; tested with 3.13)

```bash
cd Backend/ai-content-moderation
python -m venv .venv
.venv\Scripts\activate            # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
```

## Retrain

```bash
python scripts/generate_dataset.py     # only if you changed the generator; skip to keep reviewed edits in the workbook
python training/train.py               # validates, splits by template group, trains, evaluates, exports models/*.json
cd .. && node ai-content-moderation/scripts/evaluate_probe.mjs   # sanity check of the deployed engine
npm test                               # includes the Node/Python parity test
```

Restart the backend afterwards; the model is loaded once per process.

`train.py` refuses to export if the exported JSON does not reproduce scikit-learn's probabilities
(difference > 1e-3), and stops on unknown categories/severities or rows whose `is_inappropriate`
contradicts their category.

### Adding reviewed real-world data

1. Add rows to the relevant sheet of the workbook (see `datasets/README.md` for columns and the labelling guide).
   Give related variations the same `template_group` so they never straddle train and test.
2. Set `synthetic` to `False` for real, reviewed examples. Remove names, handles and other personal data first.
3. Run `python training/train.py`, read the new `models/evaluation_report.md`, run the probe script and `npm test`.
4. New slang only gets highlighted and replaced once it is in the **Vulgar Words** sheet.

## Evaluation summary (latest run)

See the generated reports for full tables, confusion matrices and error examples.

- **Held-out test split** (401 rows, split by template group), sentences and paragraphs, using the deployed policy:
  accuracy 92.1%, precision 92.6%, recall 82.2%, F1 87.1% (7 false positives, 19 false negatives out of 331).
- **Probe set** (36 hand-written sentences, never trained on): 34/36 correct. All 16 inappropriate sentences
  were caught; 2 harmless sentences got a low-severity warning; 0 harmless posts would be refused.
- **Abusive single words missing from the word list:** the deployed engine catches almost none (2.9%) by design,
  because lone words are decided by the word list. Keep the word list up to date.

These numbers come from synthetic data and one tiny probe set. They do **not** show real-world accuracy.

## Configuration (Backend `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MODERATION_FAILURE_POLICY` | `closed` | `closed`: refuse to publish posts (503) if the model can't load. `open`: publish without moderation and log a warning |
| `MODERATION_FLAG_THRESHOLD` | tuned value in the model file | Classifier-only threshold override |
| `MODERATION_MODEL_DIR` | `ai-content-moderation/models` | Where the backend loads the model from |

## Known limitations

- Synthetic, template-based data. Slang, regional spellings, sarcasm, coded hate and context outside the
  sentence are under-represented. **The Hindi/Gujarati slang was written for this project and still needs
  review by native speakers.**
- Romanized Hindi vs Gujarati language detection is a best guess from common words.
- Small categories (profanity, threat) have few test examples, so their per-category scores are noisy.
- Harmless sentences that resemble template phrasing ("Hope you all…", "This is ridiculous") can get a
  low-severity warning. They are never refused on the classifier alone.
- No image moderation, and comments are not moderated (posts only).

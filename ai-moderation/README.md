# Local multilingual moderation model (ai-moderation)

Our own moderation model for posts and comments, running **locally**. No Gemini, OpenAI, Claude or any other
external AI API is used for moderation. The Node backend calls this Python service over an internal HTTP
request before saving any post or comment.

> **Status: development prototype.** Trained on a small **synthetic** dataset (2,207 rows). It catches common
> abuse, threats and obfuscation in the supported languages, but will miss unseen slang and occasionally block
> harmless text. Read [`evaluation/report.md`](evaluation/report.md) before relying on it.

## Architecture

```
React form ──► Node/Express (POST/PUT posts, comments) ──HTTP 127.0.0.1:8001──► FastAPI service
                    │  enforceModeration() before saving                         │
                    │  422 CONTENT_MODERATION_FAILED / 503 if unavailable          ▼
                    ▼                                                inference/moderator.py
               PostgreSQL (only clean content)            normalize → word list + classifier → policy
```

| Part | What it does |
|---|---|
| `preprocessing/normalize.py` | Unicode NFKC, zero-width removal, Latin lower-casing and de-obfuscation (leet `0→o 1→i @→a`, `f*ck`, `f u c k`, `fuuuck`). Devanagari and Gujarati characters (incl. vowel signs) are kept unchanged |
| `preprocessing/lexicon.py` | Word/phrase list matching with positions in the original text (UTF-16 offsets for the browser), masked-word wildcards, context-dependent words |
| `preprocessing/language.py` | Script detection (reliable) + romanized Hindi/Gujarati/English guess from function words |
| `training/train_baseline.py` | **Baseline:** TF-IDF over character 2–5-grams + multinomial logistic regression |
| `training/train_transformer.py` | **Transformer:** `distilbert-base-multilingual-cased`, **fine-tuned locally on the CPU** (pretrained by its authors on Wikipedia in 104 languages incl. Hindi and Gujarati; *not* trained from scratch by us) |
| `evaluation/evaluate.py` | Tunes thresholds on validation data, compares both models with the full policy, selects the deployed model, writes `models/deployment.json` and `evaluation/report.md` |
| `inference/moderator.py` | The single implementation of the moderation policy (used by the service and the evaluation) |
| `inference/service.py` | FastAPI service: `GET /health`, `POST /moderate` |

**Policy:**
- Labels: `CLEAN`, `MILD_PROFANITY`, `VULGAR`, `PERSONAL_ABUSE`, `HARASSMENT`, `HATE_SPEECH`, `THREAT`. Everything except `CLEAN` is blocked.
- A listed word blocks. Otherwise the classifier blocks above the `block` threshold.
- Between the `uncertain` and `block` thresholds the decision is `uncertain`, and the backend also refuses it (with a "please rephrase" message).
- Texts under 3 words are judged by the word list only.
- Profanity aimed at a person becomes `PERSONAL_ABUSE`.
- A confident threat/hate/harassment prediction (≥ 0.7) can escalate the category.

## Setup (CPU, Python 3.11–3.13; tested with 3.13)

```bash
cd Backend/ai-moderation
python -m venv .venv
.venv\Scripts\activate                       # Windows  (macOS/Linux: source .venv/bin/activate)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
# One-time download of the pretrained transformer (~540 MB) for fine-tuning. Afterwards everything runs offline.
python -c "from huggingface_hub import snapshot_download as d; d('distilbert/distilbert-base-multilingual-cased', local_dir='models/pretrained/distilbert-base-multilingual-cased', allow_patterns=['config.json','model.safetensors','tokenizer.json','tokenizer_config.json','vocab.txt'])"
```

The venv, the pretrained download and the fine-tuned transformer weights are git-ignored (large, reproducible).
The baseline model, word list, `deployment.json` and reports are small and committed. If the transformer weights
are missing, set `"model": "baseline"` in `models/deployment.json`, or retrain.

## Run the inference service

```bash
cd Backend && npm run moderation          # starts uvicorn on 127.0.0.1:8001 with the venv's Python
# or: cd Backend/ai-moderation && .venv/Scripts/python -m uvicorn inference.service:app --host 127.0.0.1 --port 8001
curl http://127.0.0.1:8001/health
```

| Variable (service) | Default | Meaning |
|---|---|---|
| `MODERATION_MODEL` | from `models/deployment.json` | Force `baseline` or `transformer` |
| `MODERATION_THREADS` | `4` | PyTorch CPU threads |
| `MODERATION_SERVICE_KEY` | unset | If set, `/moderate` requires the same value in `X-Moderation-Key` (set it in the backend `.env` too) |

Keep the service bound to `127.0.0.1`. It is an internal API, with no auth beyond the optional key and no API docs.

## Retrain

```bash
python dataset/generate_dataset.py            # only if templates changed (overwrites the workbook)
python training/train_baseline.py             # seconds; also exports models/lexicon.json and split info
python training/train_transformer.py          # CPU fine-tuning, ~35-45 min on a laptop i5 (4 epochs)
python evaluation/evaluate.py                 # tunes thresholds, compares, writes deployment.json + report
python -m unittest discover -s tests -v       # real-model service tests
```

Then restart the service, and from `Backend/` run `npm test`, plus `MODERATION_INTEGRATION=1 npm test -- tests/moderation.integration.test.js` while the service runs.

## Evaluation results

See [`evaluation/report.md`](evaluation/report.md) (generated) for the full comparison, confusion matrices, per-language
results, false positives/negatives and the probe set. The summary is in the backend's final report.

## Known limitations

- **Synthetic data.** Real slang, sarcasm, coded hate and long context are under-represented; real-world accuracy is unknown.
- **Unreviewed slang.** Hindi and Gujarati abusive vocabulary still needs review by native speakers.
- **Romanized text** is barely present in the transformer's pretraining data, so the fine-tuned model relies on our small dataset there.
- **Language detection** between romanized Hindi and Gujarati is a best guess.
- **Implicit threats** and new slang absent from the word list are often missed. Single unknown words are never caught by the model (word list only).
- **Strict policy.** Mild profanity is blocked by project policy, and borderline texts are refused as "uncertain". Expect some false blocks on harmless text that resembles the training templates.
- **Performance.** CPU inference for the transformer takes tens of milliseconds per text. The service handles one model replica; scale it with more processes if needed.

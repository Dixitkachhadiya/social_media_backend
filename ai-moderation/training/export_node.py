"""
Exports the deployed moderation model to the Node.js backend (Backend/src/ai/moderation/model/) and writes
reference outputs used to prove that the JavaScript port gives the same results.

    python training/export_node.py

The TF-IDF + logistic regression baseline is plain arithmetic over a vocabulary, so it is exported as numbers
(no retraining, no approximation):
  classifier.json   char_wb n-gram vocabulary, idf, coefficients, intercepts, label order
  lexicon.json      word list (copied unchanged)
  deployment.json   tuned thresholds and version (written by evaluation/evaluate.py)

Reference outputs (evaluation/parity_cases.json): probabilities, decision, category, flagged terms and language
from this Python implementation for every dataset text and the probe set.
Held-out test split (evaluation/test_split_python.json): labels plus the deployed Python decisions, so
scripts/evaluate-ai.js can compute the same metrics for Python and Node.js on the same data.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from inference.moderator import Moderator  # noqa: E402
from preprocessing.normalize import normalize  # noqa: E402
from training.data import MODELS, group_split, load_dataset  # noqa: E402

TARGET = ROOT.parent / "src" / "ai" / "moderation" / "model"
PARITY = ROOT / "evaluation" / "parity_cases.json"
TEST_SPLIT = ROOT / "evaluation" / "test_split_python.json"


def export_classifier() -> dict:
    pipeline = joblib.load(MODELS / "baseline" / "model.joblib")
    tfidf, clf = pipeline.named_steps["tfidf"], pipeline.named_steps["clf"]
    # Settings the JavaScript implementation assumes; fail loudly if the model was trained differently
    expected = dict(analyzer="char_wb", lowercase=False, sublinear_tf=True, norm="l2", use_idf=True, binary=False, strip_accents=None)
    actual = {k: getattr(tfidf, k) for k in expected}
    if actual != expected:
        raise SystemExit(f"Unsupported vectorizer settings: {actual}")
    if len(clf.classes_) < 3 or getattr(clf, "multi_class", None) not in (None, "auto", "multinomial"):
        raise SystemExit("Expected a multinomial logistic regression")

    vocabulary = [None] * len(tfidf.vocabulary_)
    for ngram, index in tfidf.vocabulary_.items():
        vocabulary[index] = ngram
    return {
        "format": "tfidf-char_wb-logreg/v1",
        "name": "tfidf-char-logreg",
        "ngram_range": list(tfidf.ngram_range),
        "sublinear_tf": True,
        "labels": [str(c) for c in clf.classes_],
        "vocabulary": vocabulary,
        "idf": tfidf.idf_.tolist(),
        "coef": clf.coef_.tolist(),
        "intercept": clf.intercept_.tolist(),
    }


def reference_outputs() -> list[dict]:
    moderator = Moderator(model_kind="baseline")
    texts = list(dict.fromkeys(load_dataset(verbose=False)["text"]))
    probe = json.loads((ROOT / "evaluation" / "probe_set.json").read_text(encoding="utf-8"))["examples"]
    texts += [e["text"] for e in probe if e["text"] not in texts]
    # Edge cases: empty, whitespace, obfuscation, emoji (surrogate pairs shift UTF-16 offsets), mixed scripts
    texts += ["", "   ", "f u c k this", "you are a b1tch", "😀😀 sh!t happens 😀", "ok", "तू पागल है", "તું ગધેડો છે",
              "F*CK", "fuuuuck you", "Hello​world", "Ｆｕｌｌｗｉｄｔｈ text", "dog", "you dog"]
    cases = []
    for text in texts:
        r = moderator.moderate(text)
        cases.append({
            "text": text,
            "probabilities": moderator.probabilities([normalize(text)])[0] if normalize(text) else None,
            "decision": r["decision"], "category": r["category"], "severity": r["severity"], "confidence": r["confidence"],
            "language_code": r["language_code"], "detected_language": r["detected_language"],
            "flagged_terms": r["flagged_terms"], "explanation": r["explanation"],
        })
    return cases


def test_split_outputs() -> list[dict]:
    moderator = Moderator(model_kind="baseline")
    _, _, test = group_split(load_dataset(verbose=False))
    rows = []
    for r in test.itertuples():
        result = moderator.moderate(r.text)
        rows.append({"text": r.text, "label": r.label, "language_code": r.language_code,
                     "single_word": r.source_type == "synthetic: word list",
                     "python_decision": result["decision"], "python_category": result["category"]})
    return rows


def main():
    deployment = MODELS / "deployment.json"
    if not deployment.exists():
        raise SystemExit("models/deployment.json is missing: run evaluation/evaluate.py first (tunes the thresholds)")
    if json.loads(deployment.read_text(encoding="utf-8"))["model"] != "baseline":
        raise SystemExit("Only the baseline model can be exported to Node.js")

    TARGET.mkdir(parents=True, exist_ok=True)
    (TARGET / "classifier.json").write_text(json.dumps(export_classifier(), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    shutil.copyfile(MODELS / "lexicon.json", TARGET / "lexicon.json")
    shutil.copyfile(deployment, TARGET / "deployment.json")

    cases = reference_outputs()
    PARITY.write_text(json.dumps({"cases": cases}, ensure_ascii=False, indent=0), encoding="utf-8")
    rows = test_split_outputs()
    TEST_SPLIT.write_text(json.dumps({"rows": rows}, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"Exported model to {TARGET}, {len(cases)} reference cases to {PARITY}, {len(rows)} test rows to {TEST_SPLIT}")


if __name__ == "__main__":
    main()

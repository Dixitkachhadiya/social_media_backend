"""
Baseline: TF-IDF over character 2-5-grams (within word boundaries) + multinomial logistic regression.

    python training/train_baseline.py

Character n-grams cope with transliteration, misspellings and code-mixing, and train in seconds on a CPU.
C is chosen on the validation split (macro F1 over the 7 labels). Saves models/baseline/model.joblib.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.data import MODELS, SEED, export_lexicon, group_split, load_dataset, save_split_ids  # noqa: E402


def build(C: float) -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), min_df=2, max_features=40000, sublinear_tf=True, lowercase=False)),
        ("clf", LogisticRegression(C=C, class_weight="balanced", max_iter=4000, random_state=SEED)),
    ])


def main():
    df = load_dataset()
    train, val, test = group_split(df)
    save_split_ids(train, val, test)
    print(f"Split: train={len(train)} validation={len(val)} test={len(test)}")
    n_lex = export_lexicon(df)
    print(f"Exported word list: {n_lex} entries")

    best = None
    for C in [1.0, 3.0, 10.0, 30.0]:
        model = build(C).fit(train["norm"], train["label"])
        score = f1_score(val["label"], model.predict(val["norm"]), average="macro", zero_division=0)
        print(f"  C={C:<5} validation macro-F1={score:.3f}")
        if best is None or score > best[0]:
            best = (score, C)

    started = time.time()
    model = build(best[1]).fit(train["norm"], train["label"])
    out = MODELS / "baseline"
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, out / "model.joblib")
    (out / "metadata.json").write_text(json.dumps({
        "name": "tfidf-char-logreg", "C": best[1], "validation_macro_f1": round(best[0], 4),
        "labels": list(model.classes_), "train_rows": len(train), "train_seconds": round(time.time() - started, 1),
        "note": "Trained on the training split only; the deployed model is chosen by evaluation/evaluate.py.",
    }, indent=2), encoding="utf-8")
    print(f"Saved {out / 'model.joblib'} (C={best[1]}, validation macro-F1={best[0]:.3f})")


if __name__ == "__main__":
    main()

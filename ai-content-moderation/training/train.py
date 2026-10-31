"""
Trains and evaluates the multilingual moderation classifier, then exports it for Node.js.

    python training/train.py

Steps
  1. Load the Excel workbook (sheets 1-4) and validate columns/labels.
  2. Normalize text (text_normalization.py, mirrored in Node) and drop exact duplicates / label conflicts.
  3. Split 70/15/15 BY template_group, so variations of one template never appear in two splits.
  4. Train char n-gram TF-IDF + multinomial logistic regression; choose C on the validation split.
  5. Evaluate on the held-out test split: classifier alone, word-list baseline, and the combined system.
  6. Refit on all data and export models/moderation_model.json, models/lexicon.json,
     models/parity_fixtures.json and models/evaluation_report.{md,json}.
"""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, classification_report, confusion_matrix, f1_score,
                             precision_recall_fscore_support)
from sklearn.model_selection import GroupShuffleSplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lexicon import SEVERITY_RANK, compile_lexicon, find_matches  # noqa: E402
from text_normalization import normalize  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "datasets" / "multilingual_content_moderation_dataset.xlsx"
MODELS = ROOT / "models"
SEED = 42
CATEGORIES = ["clean", "profanity", "insult", "harassment", "threat", "hate"]
SEVERITIES = ["none", "low", "medium", "high"]
REQUIRED = {"text", "language_code", "category", "is_inappropriate", "template_group"}
VECTORIZER = dict(analyzer="char_wb", ngram_range=(2, 5), min_df=2, max_features=40000, sublinear_tf=True, lowercase=False)


# ------------------------------------------------------------------------------------------ data
def load_dataset():
    sheets = pd.read_excel(DATASET, sheet_name=None)
    frames = []
    for name in ["Vulgar Words", "Vulgar Sentences", "Clean Content", "Mixed Language"]:
        df = sheets[name]
        missing = REQUIRED - set(df.columns)
        if missing:
            raise SystemExit(f"Sheet '{name}' is missing columns: {sorted(missing)}")
        df = df.assign(sheet=name)
        frames.append(df)
        # The respectful rewrite of each abusive sentence is a clean example of the same sentence
        # (contrastive pair). It keeps the original template_group, so pairs never straddle splits.
        if "safe_rewritten_text" in df.columns:
            pairs = df[(df["category"] != "clean") & df["safe_rewritten_text"].fillna("").astype(str).str.strip().ne("")]
            frames.append(pairs.assign(text=pairs["safe_rewritten_text"], category="clean", severity="none",
                                       is_inappropriate=False, sheet=f"{name} (rewrites)"))
    df = pd.concat(frames, ignore_index=True)

    bad_cat = sorted(set(df["category"]) - set(CATEGORIES))
    if bad_cat:
        raise SystemExit(f"Unknown categories: {bad_cat}")
    inconsistent = df[(df["category"] == "clean") == df["is_inappropriate"].astype(bool)]
    if len(inconsistent):
        raise SystemExit(f"{len(inconsistent)} rows have is_inappropriate inconsistent with category")
    if "severity" in df:
        df["severity"] = df["severity"].fillna("none").replace("", "none")
        bad_sev = sorted(set(df["severity"]) - set(SEVERITIES))
        if bad_sev:
            raise SystemExit(f"Unknown severities: {bad_sev}")

    df["text"] = df["text"].astype(str)
    df["norm"] = df["text"].map(normalize)
    df = df[df["norm"].str.len() > 0]

    # Same normalized text with different labels = labelling conflict: report and drop all copies
    conflicts = df.groupby("norm")["category"].nunique()
    conflicted = set(conflicts[conflicts > 1].index)
    if conflicted:
        print(f"Dropping {len(conflicted)} normalized texts with conflicting labels")
    df = df[~df["norm"].isin(conflicted)]
    before = len(df)
    df = df.drop_duplicates("norm").reset_index(drop=True)
    print(f"Loaded {before} rows, {len(df)} after removing normalized duplicates")
    return df


def group_split(df):
    outer = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=SEED)
    train_idx, rest_idx = next(outer.split(df, groups=df["template_group"]))
    rest = df.iloc[rest_idx]
    inner = GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=SEED)
    val_idx, test_idx = next(inner.split(rest, groups=rest["template_group"]))
    train, val, test = df.iloc[train_idx], rest.iloc[val_idx], rest.iloc[test_idx]
    for a, b in [(train, val), (train, test), (val, test)]:
        assert not set(a["template_group"]) & set(b["template_group"]), "template group leaked across splits"
    return train.reset_index(drop=True), val.reset_index(drop=True), test.reset_index(drop=True)


def lexicon_entries(df):
    words = df[(df["sheet"] == "Vulgar Words") & (df["category"] != "clean")]
    return [dict(term=r.text, category=r.category, severity=r.severity, context_dependent=bool(r.context_dependent),
                 replacement="" if pd.isna(r.safe_replacement) else str(r.safe_replacement), language=r.language_code,
                 base_term=r.base_term) for r in words.itertuples()]


# ------------------------------------------------------------------------------------------ model
def fit(texts, labels, C):
    vec = TfidfVectorizer(**VECTORIZER)
    X = vec.fit_transform(texts)
    clf = LogisticRegression(C=C, class_weight="balanced", max_iter=4000, random_state=SEED)
    clf.fit(X, labels)
    return vec, clf


def p_inappropriate(clf, proba):
    return 1.0 - proba[:, list(clf.classes_).index("clean")]


# Deployed policy constants (keep in sync with Backend/src/moderation/engine.js).
# MODEL_ONLY_FLOOR is the lowest classifier-only threshold allowed; the actual value is tuned on validation.
MODEL_ONLY_FLOOR = 0.5
MIN_WORDS_FOR_MODEL = 3
TARGET_PRECISION = 0.95


def combined_predict(texts, vec, clf, lexicon, threshold):
    """Mirrors the decision logic of Backend/src/moderation/engine.js (category level)."""
    proba = clf.predict_proba(vec.transform([normalize(t) for t in texts]))
    p_bad = p_inappropriate(clf, proba)
    classes = list(clf.classes_)
    preds = []
    for text, row, pb in zip(texts, proba, p_bad):
        non_clean = [(row[i], c) for i, c in enumerate(classes) if c != "clean"]
        model_p, model_cat = max(non_clean)
        words = len(normalize(text).split())
        hits = find_matches(text, lexicon, p_inappropriate=pb, context_threshold=threshold)
        if hits:
            hit = max(hits, key=lambda h: (SEVERITY_RANK[h["severity"]], h["category"] in ("threat", "hate", "harassment")))
            category = hit["category"]
            if model_cat in ("threat", "hate", "harassment") and model_p >= 0.5:
                category = model_cat
            preds.append(category)
        elif pb >= threshold and words >= MIN_WORDS_FOR_MODEL:
            preds.append(model_cat)
        else:
            preds.append("clean")
    return preds


def binary(labels):
    return [0 if c == "clean" else 1 for c in labels]


def metrics(y_true, y_pred):
    bt, bp = binary(y_true), binary(y_pred)
    p, r, f, _ = precision_recall_fscore_support(bt, bp, average="binary", zero_division=0)
    return {
        "binary": {"accuracy": accuracy_score(bt, bp), "precision": p, "recall": r, "f1": f,
                   "confusion_matrix": confusion_matrix(bt, bp, labels=[0, 1]).tolist()},
        "category": {"accuracy": accuracy_score(y_true, y_pred),
                     "macro_f1": f1_score(y_true, y_pred, average="macro", zero_division=0),
                     "confusion_matrix": confusion_matrix(y_true, y_pred, labels=CATEGORIES).tolist(),
                     "report": classification_report(y_true, y_pred, labels=CATEGORIES, zero_division=0, output_dict=True)},
    }


# ------------------------------------------------------------------------------------------ export
def round_sig(x, digits=6):
    return 0.0 if x == 0 else float(f"{x:.{digits}g}")


def export_model(vec, clf, thresholds, path):
    vocab = vec.vocabulary_
    coef = clf.coef_
    # Drop features the classifier effectively ignores to keep the JSON small
    keep = [(ng, idx) for ng, idx in vocab.items() if np.abs(coef[:, idx]).max() >= 1e-4]
    keep.sort(key=lambda x: x[1])
    order = [idx for _, idx in keep]
    model = {
        "format": "char-wb-tfidf-logreg/v1",
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "classes": list(clf.classes_),
        "ngram_range": list(VECTORIZER["ngram_range"]),
        "sublinear_tf": True,
        "thresholds": thresholds,
        "vocabulary": {ng: i for i, (ng, _) in enumerate(keep)},
        "idf": [round_sig(v) for v in vec.idf_[order]],
        "coef": [[round_sig(v) for v in row[order]] for row in coef],
        "intercept": [round_sig(v) for v in clf.intercept_],
        "notes": "Trained on a SYNTHETIC dataset. See models/evaluation_report.md for measured performance and limits.",
    }
    path.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return len(keep)


def predict_exported(model, text):
    """Reference implementation of the Node inference, used to verify the export."""
    norm = normalize(text)
    lo, hi = model["ngram_range"]
    counts = {}
    for w in norm.split():
        w = f" {w} "
        for n in range(lo, hi + 1):
            offset = 0
            counts[w[offset:offset + n]] = counts.get(w[offset:offset + n], 0) + 1
            while offset + n < len(w):
                offset += 1
                counts[w[offset:offset + n]] = counts.get(w[offset:offset + n], 0) + 1
            if offset == 0:
                break
    feats = {}
    for ng, c in counts.items():
        i = model["vocabulary"].get(ng)
        if i is not None:
            feats[i] = (1 + math.log(c)) * model["idf"][i]
    norm2 = math.sqrt(sum(v * v for v in feats.values())) or 1.0
    scores = [b + sum(row[i] * v / norm2 for i, v in feats.items()) for row, b in zip(model["coef"], model["intercept"])]
    m = max(scores)
    exps = [math.exp(s - m) for s in scores]
    total = sum(exps)
    return norm, [e / total for e in exps]


# ------------------------------------------------------------------------------------------ main
def main():
    MODELS.mkdir(exist_ok=True)
    df = load_dataset()
    train, val, test = group_split(df)
    print(f"Split by template group: train={len(train)} val={len(val)} test={len(test)}")

    # Model selection on validation (classifier alone, macro F1 over categories)
    best = None
    for C in [1.0, 3.0, 10.0, 30.0]:
        vec, clf = fit(train["norm"], train["category"], C)
        pred = clf.predict(vec.transform(val["norm"]))
        score = f1_score(val["category"], pred, average="macro", zero_division=0)
        print(f"  C={C:<5} validation macro-F1={score:.3f}")
        if best is None or score > best[0]:
            best = (score, C)
    C = best[1]

    vec, clf = fit(train["norm"], train["category"], C)
    val_proba = clf.predict_proba(vec.transform(val["norm"]))
    val_bad = p_inappropriate(clf, val_proba)
    val_true = np.array(binary(val["category"]))
    # Flag threshold: best binary F1 on validation; "confident" threshold: lowest with precision >= 0.95
    candidates = np.round(np.arange(0.30, 0.91, 0.05), 2)
    f1s = [f1_score(val_true, (val_bad >= t).astype(int), zero_division=0) for t in candidates]
    flag_t = float(candidates[int(np.argmax(f1s))])
    confident_t = next((float(t) for t in candidates if t >= flag_t and
                        precision_recall_fscore_support(val_true, (val_bad >= t).astype(int), average="binary", zero_division=0)[0] >= 0.95),
                       float(max(flag_t, 0.75)))
    lex_train_for_val = compile_lexicon(lexicon_entries(train))
    val_sent = val[val["sheet"] != "Vulgar Words"]
    model_only_t = 0.9
    for t in np.round(np.arange(MODEL_ONLY_FLOOR, 0.91, 0.05), 2):
        pred = combined_predict(list(val_sent["text"]), vec, clf, lex_train_for_val, float(t))
        prec = precision_recall_fscore_support(binary(val_sent["category"]), binary(pred), average="binary", zero_division=0)[0]
        if prec >= TARGET_PRECISION:
            model_only_t = float(t)
            break
    thresholds = {"flag": flag_t, "confident": confident_t, "context": 0.5, "model_only": model_only_t}
    print(f"Chosen C={C}, thresholds={thresholds}")

    # ---- held-out test evaluation
    lex_train = compile_lexicon(lexicon_entries(train))
    test_texts = list(test["text"])
    y_test = list(test["category"])
    clf_pred = list(clf.predict(vec.transform(test["norm"])))
    clf_proba = clf.predict_proba(vec.transform(test["norm"]))
    clf_bad = p_inappropriate(clf, clf_proba)
    clf_pred_thr = [c if b >= flag_t else "clean" for c, b in zip(
        [max(((p, k) for k, p in zip(clf.classes_, row) if k != "clean"))[1] for row in clf_proba], clf_bad)]
    lex_pred = []
    for t in test_texts:
        hits = find_matches(t, lex_train)
        lex_pred.append(max(hits, key=lambda h: SEVERITY_RANK[h["severity"]])["category"] if hits else "clean")
    comb_pred = combined_predict(test_texts, vec, clf, lex_train, model_only_t)

    # Sentences/paragraphs (what posts look like) and single words are reported separately: test-split
    # words are deliberately absent from the evaluation word list, so they measure how the system copes
    # with abusive words it has never been given.
    is_word = (test["sheet"] == "Vulgar Words").to_numpy()
    sent_idx = [i for i in range(len(test)) if not is_word[i]]
    word_idx = [i for i in range(len(test)) if is_word[i] and y_test[i] != "clean"]
    pick = lambda seq, idx: [seq[i] for i in idx]  # noqa: E731
    y_sent = pick(y_test, sent_idx)
    results = {
        "word_list_baseline": metrics(y_sent, pick(lex_pred, sent_idx)),
        "classifier": metrics(y_sent, pick(clf_pred_thr, sent_idx)),
        "combined": metrics(y_sent, pick(comb_pred, sent_idx)),  # deployed policy (thresholds and short-text rule)
    }
    unseen_words = {
        "n": len(word_idx),
        "classifier_recall": sum(clf_pred_thr[i] != "clean" for i in word_idx) / max(1, len(word_idx)),
        "deployed_recall": sum(comb_pred[i] != "clean" for i in word_idx) / max(1, len(word_idx)),
    }

    per_language = {}
    for lang, idx in test.iloc[sent_idx].groupby("language_code").groups.items():
        idx = list(idx)
        if len(idx) < 10:
            per_language[lang] = {"n": len(idx), "note": "too few test examples for a reliable estimate"}
            continue
        yt = [y_test[i] for i in idx]
        yp = [comb_pred[i] for i in idx]
        m = metrics(yt, yp)["binary"]
        per_language[lang] = {"n": len(idx), "accuracy": m["accuracy"], "precision": m["precision"], "recall": m["recall"], "f1": m["f1"]}

    errors = test.iloc[sent_idx].assign(pred=pick(comb_pred, sent_idx), p_bad=np.round(clf_bad[sent_idx], 3))
    false_pos = errors[(errors["category"] == "clean") & (errors["pred"] != "clean")]
    false_neg = errors[(errors["category"] != "clean") & (errors["pred"] == "clean")]

    # ---- final model on ALL data, exported for Node
    final_vec, final_clf = fit(df["norm"], df["category"], C)
    n_features = export_model(final_vec, final_clf, thresholds, MODELS / "moderation_model.json")
    lexicon = lexicon_entries(df)
    (MODELS / "lexicon.json").write_text(json.dumps({
        "format": "moderation-lexicon/v1", "entries": [{k: e[k] for k in ("term", "category", "severity", "context_dependent", "replacement", "language", "base_term")} for e in lexicon],
    }, ensure_ascii=False, indent=0), encoding="utf-8")

    # Verify the export reproduces sklearn exactly, and write fixtures for the Node parity test
    model_json = json.loads((MODELS / "moderation_model.json").read_text(encoding="utf-8"))
    fixture_texts = list(test.sample(min(40, len(test)), random_state=SEED)["text"]) + [
        "You are such a F U C K I N G idiot!!!", "sh!t this is b@d", "Tu ekdum ch*tiya hai", "chhod do yaar",
        "Gandhinagar is lovely", "मेरा कुत्ता बहुत प्यारा है", "તું સાવ નાલાયક છે", "fuuuuuck", "  weird​ spacing\t\there ",
        "Mixed तुम and ગુજરાતી text 123", "",
    ]
    fixtures, max_diff = [], 0.0
    final_proba = final_clf.predict_proba(final_vec.transform([normalize(t) for t in fixture_texts]))
    for text, sk in zip(fixture_texts, final_proba):
        norm, probs = predict_exported(model_json, text)
        max_diff = max(max_diff, max(abs(a - b) for a, b in zip(probs, sk)))
        fixtures.append({"text": text, "normalized": norm, "probabilities": [round(p, 6) for p in probs]})
    (MODELS / "parity_fixtures.json").write_text(json.dumps({"classes": model_json["classes"], "fixtures": fixtures}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Export check: max |exported - sklearn| probability difference = {max_diff:.2e}")
    if max_diff > 1e-3:
        raise SystemExit("Exported model does not reproduce sklearn predictions")

    report = {
        "created_at": model_json["created_at"], "dataset": str(DATASET.relative_to(ROOT)), "rows_used": len(df),
        "split": {"train": len(train), "validation": len(val), "test": len(test), "method": "GroupShuffleSplit by template_group (70/15/15)"},
        "model": {"vectorizer": VECTORIZER, "classifier": f"LogisticRegression(C={C}, class_weight=balanced)", "exported_features": n_features},
        "thresholds": thresholds, "deployed_policy": {"model_only_min": thresholds["model_only"], "min_words_for_model": MIN_WORDS_FOR_MODEL, "target_precision": TARGET_PRECISION},
        "results": results, "unseen_words": unseen_words, "per_language": per_language,
        "false_positives": false_pos[["text", "language_code", "pred", "p_bad"]].head(25).to_dict("records"),
        "false_negatives": false_neg[["text", "language_code", "category", "p_bad"]].head(25).to_dict("records"),
    }
    (MODELS / "evaluation_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=float), encoding="utf-8")
    write_markdown(report)
    print_summary(report)


def pct(x):
    return f"{100 * x:.1f}%"


def write_markdown(r):
    lines = [
        "# Moderation model evaluation", "",
        f"Generated {r['created_at']} by `training/train.py`.", "",
        "> **Read this first.** All numbers are measured on a held-out split of a **synthetic, template-generated** dataset.",
        "> The split keeps every template in one split only, but test sentences still share vocabulary and style with training data.",
        "> Real-world performance on genuine user posts is unknown and is expected to be lower. Review real examples before relying on it.", "",
        f"- Rows used: {r['rows_used']} (train {r['split']['train']}, validation {r['split']['validation']}, test {r['split']['test']}); {r['split']['method']}",
        f"- Model: {r['model']['classifier']} on char_wb 2-5-gram TF-IDF; {r['model']['exported_features']} exported features",
        f"- Thresholds (chosen on validation): flag >= {r['thresholds']['flag']}, confident >= {r['thresholds']['confident']}", "",
        "## Inappropriate vs clean (test split, sentences and paragraphs)", "",
        "The combined row applies the deployed engine policy: classifier-only results need p >= %s and at least %s words." % (r["deployed_policy"]["model_only_min"], r["deployed_policy"]["min_words_for_model"]), "",
        "| System | Accuracy | Precision | Recall | F1 |", "|---|---|---|---|---|",
    ]
    for name, label in [("word_list_baseline", "Word list only (baseline)"), ("classifier", "Classifier only"), ("combined", "Combined (as used by the backend)")]:
        b = r["results"][name]["binary"]
        lines.append(f"| {label} | {pct(b['accuracy'])} | {pct(b['precision'])} | {pct(b['recall'])} | {pct(b['f1'])} |")
    cm = r["results"]["combined"]["binary"]["confusion_matrix"]
    lines += ["", "Combined confusion matrix (rows = true, columns = predicted):", "",
              "| | predicted clean | predicted inappropriate |", "|---|---|---|",
              f"| **clean** | {cm[0][0]} | {cm[0][1]} |", f"| **inappropriate** | {cm[1][0]} | {cm[1][1]} |", "",
              "## Category accuracy (combined system)", "",
              f"Accuracy {pct(r['results']['combined']['category']['accuracy'])}, macro F1 {pct(r['results']['combined']['category']['macro_f1'])}", "",
              "| Category | Precision | Recall | F1 | Support |", "|---|---|---|---|---|"]
    rep = r["results"]["combined"]["category"]["report"]
    for c in CATEGORIES:
        x = rep.get(c, {})
        lines.append(f"| {c} | {pct(x.get('precision', 0))} | {pct(x.get('recall', 0))} | {pct(x.get('f1-score', 0))} | {int(x.get('support', 0))} |")
    lines += ["", "Category confusion matrix (rows = true, columns = predicted; order: " + ", ".join(CATEGORIES) + "):", "", "```"]
    for c, row in zip(CATEGORIES, r["results"]["combined"]["category"]["confusion_matrix"]):
        lines.append(f"{c:<11} " + " ".join(f"{v:>4}" for v in row))
    uw = r["unseen_words"]
    lines += ["```", "", "## Abusive single words missing from the word list", "",
              f"{uw['n']} test words whose terms were held out of the word list: classifier alone detects {pct(uw['classifier_recall'])}; "
              f"the deployed engine detects {pct(uw['deployed_recall'])} (a lone word is decided by the word list only). "
              "New slang must be added to the word list (Vulgar Words sheet) to be caught on its own."]
    lines += ["", "## Per language (combined, binary)", "", "| Language | n | Accuracy | Precision | Recall | F1 |", "|---|---|---|---|---|---|"]
    for lang, m in sorted(r["per_language"].items()):
        if "note" in m:
            lines.append(f"| {lang} | {m['n']} | {m['note']} | | | |")
        else:
            lines.append(f"| {lang} | {m['n']} | {pct(m['accuracy'])} | {pct(m['precision'])} | {pct(m['recall'])} | {pct(m['f1'])} |")
    lines += ["", "## False positives (clean text flagged)", ""]
    lines += [f"- `{e['language_code']}` p={e['p_bad']} → {e['pred']}: {e['text']}" for e in r["false_positives"]] or ["- none in the test split"]
    lines += ["", "## False negatives (inappropriate text missed)", ""]
    lines += [f"- `{e['language_code']}` p={e['p_bad']} ({e['category']}): {e['text']}" for e in r["false_negatives"]] or ["- none in the test split"]
    (MODELS / "evaluation_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_summary(r):
    print("\nTest split (inappropriate vs clean):")
    for name in ["word_list_baseline", "classifier", "combined"]:
        b = r["results"][name]["binary"]
        print(f"  {name:<20} acc={pct(b['accuracy'])} precision={pct(b['precision'])} recall={pct(b['recall'])} f1={pct(b['f1'])} cm={b['confusion_matrix']}")
    c = r["results"]["combined"]["category"]
    print(f"  combined categories  acc={pct(c['accuracy'])} macro-F1={pct(c['macro_f1'])}")
    print(f"  false positives={len(r['false_positives'])} false negatives={len(r['false_negatives'])}")
    print(f"  unseen single words: n={r['unseen_words']['n']} classifier recall={pct(r['unseen_words']['classifier_recall'])} deployed recall={pct(r['unseen_words']['deployed_recall'])}")
    print("Per language:", {k: (v.get("f1") and round(v["f1"], 3)) or v.get("note") for k, v in r["per_language"].items()})


if __name__ == "__main__":
    main()

"""
Evaluates both models with the full moderation policy, tunes thresholds on VALIDATION data, selects the
deployed model and writes models/deployment.json plus evaluation/report.{md,json}.

    python evaluation/evaluate.py

Honesty rules
  - Thresholds and model selection use the validation split only; the test split is reported, never tuned on.
  - During evaluation the word list is built from TRAINING words only, so test-split words cannot leak in.
  - Results on sentences/paragraphs and on single words are reported separately.
  - All data is synthetic; see the warning at the top of the report.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from inference.moderator import LABELS, Moderator  # noqa: E402
from training.data import MODELS, group_split, lexicon_entries, load_dataset  # noqa: E402

OUT = ROOT / "evaluation"
TARGET_PRECISION = 0.95       # block threshold: lowest value reaching this precision on validation
MAX_CLEAN_FLAGGED = 0.05      # uncertain threshold: at most this share of clean validation texts held back


def chunked_probs(moderator, texts, size=64):
    out = []
    for i in range(0, len(texts), size):
        out += moderator.probabilities(texts[i:i + size])
    return out


def decide(moderator, df, probs, block, uncertain):
    moderator.thresholds = {"block": block, "uncertain": uncertain}
    return [moderator.moderate(t, p) for t, p in zip(df["text"], probs)]


def binary_scores(y_true_toxic, flagged):
    p, r, f, _ = precision_recall_fscore_support(y_true_toxic, flagged, average="binary", zero_division=0)
    return {"accuracy": accuracy_score(y_true_toxic, flagged), "precision": p, "recall": r, "f1": f,
            "confusion_matrix": confusion_matrix(y_true_toxic, flagged, labels=[0, 1]).tolist()}


def tune(moderator, val, val_probs):
    sentences = ~val["source_type"].eq("synthetic: word list")
    v = val[sentences].reset_index(drop=True)
    vp = [p for p, keep in zip(val_probs, sentences) if keep]
    y = (v["label"] != "CLEAN").astype(int).tolist()
    grid = [round(x, 2) for x in np.arange(0.5, 0.96, 0.05)]
    block = 0.95
    for t in grid:
        res = decide(moderator, v, vp, t, t)
        if precision_recall_fscore_support(y, [r["decision"] == "block" for r in res], average="binary", zero_division=0)[0] >= TARGET_PRECISION:
            block = t
            break
    uncertain = block
    clean_idx = [i for i, yy in enumerate(y) if yy == 0]
    for t in sorted([g for g in grid if g < block] + [round(block - 0.05 * k, 2) for k in range(1, 6)], reverse=False):
        if t < 0.3 or t >= block:
            continue
        res = decide(moderator, v, vp, block, t)
        held = sum(res[i]["blocked"] for i in clean_idx) / max(1, len(clean_idx))
        if held <= MAX_CLEAN_FLAGGED:
            uncertain = t
            break
    res = decide(moderator, v, vp, block, uncertain)
    flagged = [int(r["blocked"]) for r in res]
    return {"block": block, "uncertain": uncertain}, binary_scores(y, flagged)


def evaluate_kind(kind, train, val, test, probe):
    eval_lexicon = lexicon_entries(train)  # training words only
    m = Moderator(model_kind=kind, lexicon_entries=eval_lexicon)
    started = time.time()
    val_probs = chunked_probs(m, list(val["norm"]))
    test_probs = chunked_probs(m, list(test["norm"]))
    infer_seconds = time.time() - started

    # Raw classifier (argmax over 7 labels), whole test split
    raw_pred = [max(p, key=p.get) for p in test_probs]
    raw = {
        "accuracy_7_labels": accuracy_score(test["label"], raw_pred),
        "macro_f1_7_labels": f1_score(test["label"], raw_pred, average="macro", zero_division=0),
        "binary": binary_scores((test["label"] != "CLEAN").astype(int).tolist(), [int(p != "CLEAN") for p in raw_pred]),
    }

    thresholds, val_policy = tune(m, val, val_probs)
    results = decide(m, test, test_probs, thresholds["block"], thresholds["uncertain"])
    is_word = test["source_type"].eq("synthetic: word list").to_numpy()
    sent = [i for i in range(len(test)) if not is_word[i]]
    y_sent = [int(test["label"].iloc[i] != "CLEAN") for i in sent]
    blocked = [int(results[i]["blocked"]) for i in sent]
    hard_blocked = [int(results[i]["decision"] == "block") for i in sent]
    policy = {
        "blocked_incl_uncertain": binary_scores(y_sent, blocked),
        "blocked_only": binary_scores(y_sent, hard_blocked),
        "uncertain_share": sum(results[i]["decision"] == "uncertain" for i in sent) / max(1, len(sent)),
    }
    toxic_sent = [i for i in sent if test["label"].iloc[i] != "CLEAN" and results[i]["blocked"]]
    cat_true = [test["label"].iloc[i] for i in toxic_sent]
    cat_pred = [results[i]["category"] for i in toxic_sent]
    policy["category_accuracy_on_blocked_toxic"] = accuracy_score(cat_true, cat_pred) if toxic_sent else None
    policy["category_confusion_matrix"] = confusion_matrix(cat_true, cat_pred, labels=LABELS[1:]).tolist() if toxic_sent else []

    per_language = {}
    for lang in sorted(set(test["language_code"].iloc[sent])):
        idx = [k for k, i in enumerate(sent) if test["language_code"].iloc[i] == lang]
        if len(idx) < 10:
            per_language[lang] = {"n": len(idx), "note": "too few test examples for a reliable estimate"}
            continue
        s = binary_scores([y_sent[k] for k in idx], [blocked[k] for k in idx])
        per_language[lang] = {"n": len(idx), **{k: s[k] for k in ("accuracy", "precision", "recall", "f1")}}

    word_idx = [i for i in range(len(test)) if is_word[i] and test["label"].iloc[i] != "CLEAN"]
    unseen_words = {"n": len(word_idx), "blocked_share": sum(results[i]["blocked"] for i in word_idx) / max(1, len(word_idx))}

    false_pos = [{"text": test["text"].iloc[i], "lang": test["language_code"].iloc[i], "decision": results[i]["decision"],
                  "category": results[i]["category"], "confidence": results[i]["confidence"]}
                 for i in sent if test["label"].iloc[i] == "CLEAN" and results[i]["blocked"]]
    false_neg = [{"text": test["text"].iloc[i], "lang": test["language_code"].iloc[i], "label": test["label"].iloc[i],
                  "confidence": results[i]["confidence"]}
                 for i in sent if test["label"].iloc[i] != "CLEAN" and not results[i]["blocked"]]

    # Probe set with the deployed configuration (full word list, tuned thresholds)
    deployed = Moderator(model_kind=kind, thresholds=thresholds)
    probe_rows = []
    for e in probe:
        r = deployed.moderate(e["text"])
        probe_rows.append({**e, "decision": r["decision"], "category": r["category"], "confidence": r["confidence"]})
    py = [int(e["label"] != "CLEAN") for e in probe_rows]
    pf = [int(e["decision"] != "allow") for e in probe_rows]

    latency = []
    for text in list(test["text"].iloc[:60]):
        t0 = time.perf_counter()
        deployed.moderate(text)
        latency.append((time.perf_counter() - t0) * 1000)

    return {
        "model": m.name, "thresholds": thresholds, "validation_policy": val_policy, "raw_classifier_test": raw,
        "policy_test": policy, "per_language": per_language, "unseen_single_words": unseen_words,
        "false_positives": false_pos[:25], "false_negatives": false_neg[:25],
        "false_positive_count": len(false_pos), "false_negative_count": len(false_neg),
        "probe": {"n": len(probe_rows), **binary_scores(py, pf), "rows": probe_rows,
                  "clean_blocked": [r["text"] for r in probe_rows if r["label"] == "CLEAN" and r["decision"] != "allow"],
                  "toxic_allowed": [r["text"] for r in probe_rows if r["label"] != "CLEAN" and r["decision"] == "allow"]},
        "latency_ms": {"median": float(np.median(latency)), "p95": float(np.percentile(latency, 95))},
        "batch_inference_seconds": round(infer_seconds, 1),
    }


def pct(x):
    return "n/a" if x is None else f"{100 * x:.1f}%"


def write_report(report):
    L = [
        "# Moderation model evaluation", "",
        f"Generated {report['created_at']} by `evaluation/evaluate.py`.", "",
        "> **Synthetic data warning.** Every number below is measured on a held-out split of a synthetic, template-generated",
        "> dataset (templates never straddle splits). Test sentences still resemble training sentences, so real-world accuracy",
        "> on genuine posts is unknown and expected to be lower. The probe set is small and hand-written.", "",
        f"- Rows: train {report['split']['train']}, validation {report['split']['validation']}, test {report['split']['test']} "
        "(grouped by template; clean counterparts included)",
        f"- Thresholds tuned on validation: block = lowest with precision >= {TARGET_PRECISION:.0%}; "
        f"uncertain = lowest keeping <= {MAX_CLEAN_FLAGGED:.0%} of clean validation texts held back",
        f"- **Deployed model: {report['deployed']['model']}** (chosen by validation F1 of the full policy)", "",
        "## Model comparison (test split)", "",
        "| | Baseline: TF-IDF + logistic regression | Fine-tuned DistilBERT-multilingual |", "|---|---|---|",
    ]
    kinds = [k for k in ("baseline", "transformer") if k in report["models"]]
    cols = lambda f: " | ".join(f(report["models"][k]) for k in kinds) + (" | not trained" if len(kinds) == 1 else "")  # noqa: E731
    L += [
        f"| Raw classifier: 7-label accuracy | {cols(lambda r: pct(r['raw_classifier_test']['accuracy_7_labels']))} |",
        f"| Raw classifier: 7-label macro F1 | {cols(lambda r: pct(r['raw_classifier_test']['macro_f1_7_labels']))} |",
        f"| Thresholds (block / uncertain) | {cols(lambda r: f\"{r['thresholds']['block']} / {r['thresholds']['uncertain']}\")} |",
        f"| **Policy on sentences: precision** | {cols(lambda r: pct(r['policy_test']['blocked_incl_uncertain']['precision']))} |",
        f"| **Policy on sentences: recall** | {cols(lambda r: pct(r['policy_test']['blocked_incl_uncertain']['recall']))} |",
        f"| **Policy on sentences: F1** | {cols(lambda r: pct(r['policy_test']['blocked_incl_uncertain']['f1']))} |",
        f"| Policy accuracy | {cols(lambda r: pct(r['policy_test']['blocked_incl_uncertain']['accuracy']))} |",
        f"| Share held as 'uncertain' | {cols(lambda r: pct(r['policy_test']['uncertain_share']))} |",
        f"| Category accuracy (blocked toxic) | {cols(lambda r: pct(r['policy_test']['category_accuracy_on_blocked_toxic']))} |",
        f"| False positives / false negatives | {cols(lambda r: f\"{r['false_positive_count']} / {r['false_negative_count']}\")} |",
        f"| Unseen single words blocked | {cols(lambda r: pct(r['unseen_single_words']['blocked_share']))} |",
        f"| Probe set (n={report['models'][kinds[0]]['probe']['n']}): accuracy | {cols(lambda r: pct(r['probe']['accuracy']))} |",
        f"| Probe: clean texts blocked | {cols(lambda r: str(len(r['probe']['clean_blocked'])))} |",
        f"| Probe: toxic texts allowed | {cols(lambda r: str(len(r['probe']['toxic_allowed'])))} |",
        f"| Latency per text (median / p95) | {cols(lambda r: f\"{r['latency_ms']['median']:.0f} / {r['latency_ms']['p95']:.0f} ms\")} |",
        "",
        "\"Policy\" = what the service does: word list (training words only during evaluation) + model + thresholds; "
        "a text counts as blocked when the decision is `block` or `uncertain`.", "",
    ]
    for k in kinds:
        r = report["models"][k]
        cm = r["policy_test"]["blocked_incl_uncertain"]["confusion_matrix"]
        L += [f"## {r['model']}", "",
              "Policy confusion matrix on test sentences (rows = true, columns = predicted):", "",
              "| | allowed | blocked |", "|---|---|---|",
              f"| **clean** | {cm[0][0]} | {cm[0][1]} |", f"| **toxic** | {cm[1][0]} | {cm[1][1]} |", "",
              "Category confusion among blocked toxic texts (rows = true, cols = predicted; " + ", ".join(LABELS[1:]) + "):", "", "```"]
        for lab, row in zip(LABELS[1:], r["policy_test"]["category_confusion_matrix"]):
            L.append(f"{lab:<15}" + "".join(f"{v:>5}" for v in row))
        L += ["```", "", "| Language | n | Accuracy | Precision | Recall | F1 |", "|---|---|---|---|---|---|"]
        for lang, s in r["per_language"].items():
            L.append(f"| {lang} | {s['n']} | {s.get('note', pct(s.get('accuracy')))} | {pct(s.get('precision')) if 'note' not in s else ''} | "
                     f"{pct(s.get('recall')) if 'note' not in s else ''} | {pct(s.get('f1')) if 'note' not in s else ''} |")
        L += ["", "False positives (clean text blocked):", ""]
        L += [f"- `{e['lang']}` {e['decision']} → {e['category']} ({e['confidence']}): {e['text']}" for e in r["false_positives"]] or ["- none"]
        L += ["", "False negatives (toxic text allowed):", ""]
        L += [f"- `{e['lang']}` {e['label']} ({e['confidence']}): {e['text']}" for e in r["false_negatives"]] or ["- none"]
        L += ["", "Probe set:", "", "| Text | Expected | Decision | Category | Confidence |", "|---|---|---|---|---|"]
        L += [f"| {e['text']} | {e['label']} | {e['decision']} | {e['category']} | {e['confidence']} |" for e in r["probe"]["rows"]]
        L.append("")
    (OUT / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def main():
    df = load_dataset(verbose=False)
    train, val, test = group_split(df)
    probe = json.loads((OUT / "probe_set.json").read_text(encoding="utf-8"))["examples"]
    kinds = ["baseline"] + (["transformer"] if (MODELS / "transformer" / "config.json").exists() else [])
    models = {}
    for kind in kinds:
        print(f"Evaluating {kind}...", flush=True)
        models[kind] = evaluate_kind(kind, train, val, test, probe)
        r = models[kind]
        print(f"  thresholds {r['thresholds']}; test policy {pct(r['policy_test']['blocked_incl_uncertain']['precision'])} precision, "
              f"{pct(r['policy_test']['blocked_incl_uncertain']['recall'])} recall, F1 {pct(r['policy_test']['blocked_incl_uncertain']['f1'])}; "
              f"probe {pct(r['probe']['accuracy'])} (clean blocked {len(r['probe']['clean_blocked'])}, toxic allowed {len(r['probe']['toxic_allowed'])}); "
              f"latency {r['latency_ms']['median']:.0f} ms")

    # Model selection on VALIDATION policy F1; ties go to the faster baseline
    chosen = max(kinds, key=lambda k: (round(models[k]["validation_policy"]["f1"], 3), k == "baseline"))
    version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    deployment = {"model": chosen, "thresholds": models[chosen]["thresholds"], "version": f"{chosen}-{version}",
                  "selected_by": "validation F1 of the full moderation policy",
                  "validation_f1": {k: round(models[k]["validation_policy"]["f1"], 4) for k in kinds}}
    (MODELS / "deployment.json").write_text(json.dumps(deployment, indent=2), encoding="utf-8")
    report = {"created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "split": {"train": len(train), "validation": len(val), "test": len(test)},
              "deployed": deployment, "models": models}
    (OUT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=float), encoding="utf-8")
    write_report(report)
    print(f"Deployed model: {chosen} ({deployment['validation_f1']}) -> models/deployment.json; report: evaluation/report.md")


if __name__ == "__main__":
    main()

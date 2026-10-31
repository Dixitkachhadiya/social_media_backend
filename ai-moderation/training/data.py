"""
Loads and validates the Excel dataset and produces leakage-free train/validation/test splits.

- Columns and labels are validated (unknown category/severity, is_toxic inconsistent with category).
- Each row's clean_counterpart becomes an extra Clean example in the same template_group
  (a contrastive pair: the same sentence with and without abuse).
- Text is normalized with preprocessing.normalize (scripts are preserved).
- Exact duplicates (after normalization) are dropped; texts with conflicting labels are removed.
- The split is grouped by template_group (70/15/15): variations of one template never appear in two splits.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
from sklearn.model_selection import GroupShuffleSplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from preprocessing.normalize import normalize  # noqa: E402

DATASET = ROOT / "dataset" / "multilingual_vulgar_content_dataset.xlsx"
MODELS = ROOT / "models"
SEED = 42

# Workbook category -> model label
LABELS = {
    "Clean": "CLEAN",
    "Mild profanity": "MILD_PROFANITY",
    "Vulgar language": "VULGAR",
    "Personal abuse": "PERSONAL_ABUSE",
    "Harassment": "HARASSMENT",
    "Hate speech": "HATE_SPEECH",
    "Threatening language": "THREAT",
}
LABEL_ORDER = list(LABELS.values())
SEVERITIES = {"none", "low", "medium", "high"}
REQUIRED = ["id", "text", "language", "script", "category", "severity", "is_toxic", "target_type", "explanation", "source_type"]
DATA_SHEETS = ["1 English", "2 Hindi", "3 Gujarati", "4 Hinglish", "5 Hindi romanized", "6 Gujarati romanized",
               "7 Mixed language", "8 Clean conversations", "9 Criticism and opinions"]


def load_dataset(verbose: bool = True) -> pd.DataFrame:
    sheets = pd.read_excel(DATASET, sheet_name=None)
    frames = []
    for name in DATA_SHEETS:
        if name not in sheets:
            raise SystemExit(f"Missing sheet: {name}")
        df = sheets[name]
        missing = [c for c in REQUIRED if c not in df.columns]
        if missing:
            raise SystemExit(f"Sheet '{name}' is missing columns: {missing}")
        frames.append(df.assign(sheet=name))
    df = pd.concat(frames, ignore_index=True)
    df["text"] = df["text"].astype(str)
    df["severity"] = df["severity"].fillna("none")

    unknown = sorted(set(df["category"]) - set(LABELS))
    if unknown:
        raise SystemExit(f"Unknown categories: {unknown}")
    bad_sev = sorted(set(df["severity"]) - SEVERITIES)
    if bad_sev:
        raise SystemExit(f"Unknown severities: {bad_sev}")
    inconsistent = df[(df["category"] == "Clean") == df["is_toxic"].astype(bool)]
    if len(inconsistent):
        raise SystemExit(f"{len(inconsistent)} rows have is_toxic inconsistent with category, e.g. {inconsistent['id'].head(3).tolist()}")
    if df["text"].str.strip().eq("").any():
        raise SystemExit("Empty text found")

    # Contrastive clean counterparts (same template group -> same split)
    cc = df[(df["category"] != "Clean") & df["clean_counterpart"].fillna("").astype(str).str.strip().ne("")]
    pairs = cc.assign(text=cc["clean_counterpart"].astype(str), category="Clean", severity="none", is_toxic=False,
                      target_type="none", sheet=cc["sheet"] + " (clean counterpart)")
    df = pd.concat([df, pairs], ignore_index=True)

    df["label"] = df["category"].map(LABELS)
    df["norm"] = df["text"].map(normalize)
    df = df[df["norm"].str.len() > 0]
    conflicts = df.groupby("norm")["label"].nunique()
    conflicted = set(conflicts[conflicts > 1].index)
    df = df[~df["norm"].isin(conflicted)]
    before = len(df)
    df = df.drop_duplicates("norm").reset_index(drop=True)
    if verbose:
        print(f"Dataset: {before} rows ({len(cc)} clean counterparts added), {len(df)} after de-duplication, "
              f"{len(conflicted)} conflicting texts removed")
    return df


def group_split(df: pd.DataFrame):
    outer = GroupShuffleSplit(n_splits=1, test_size=0.30, random_state=SEED)
    train_idx, rest_idx = next(outer.split(df, groups=df["template_group"]))
    rest = df.iloc[rest_idx]
    inner = GroupShuffleSplit(n_splits=1, test_size=0.50, random_state=SEED)
    val_idx, test_idx = next(inner.split(rest, groups=rest["template_group"]))
    train, val, test = df.iloc[train_idx], rest.iloc[val_idx], rest.iloc[test_idx]
    for a, b in [(train, val), (train, test), (val, test)]:
        assert not set(a["template_group"]) & set(b["template_group"]), "template group leaked across splits"
        assert not set(a["norm"]) & set(b["norm"]), "duplicate text across splits"
    return train.reset_index(drop=True), val.reset_index(drop=True), test.reset_index(drop=True)


def lexicon_entries(df: pd.DataFrame) -> list[dict]:
    """Word-list rows (toxic) used for highlighting and as a high-precision signal."""
    words = df[(df["source_type"] == "synthetic: word list") & df["is_toxic"].astype(bool)]
    return [dict(term=r.text, category=LABELS[r.category], severity=r.severity,
                 context_dependent=bool(r.context_dependent) if not pd.isna(r.context_dependent) else False,
                 language=r.language_code) for r in words.itertuples()]


def export_lexicon(df: pd.DataFrame) -> int:
    entries = lexicon_entries(df)
    (MODELS / "lexicon.json").write_text(json.dumps({"format": "moderation-lexicon/v2", "entries": entries},
                                                    ensure_ascii=False, indent=0), encoding="utf-8")
    return len(entries)


def save_split_ids(train, val, test):
    """Stores which normalized texts belong to which split, so every script evaluates the same test set."""
    (MODELS / "split.json").write_text(json.dumps({
        "seed": SEED, "train": len(train), "validation": len(val), "test": len(test),
        "test_groups": sorted(set(test["template_group"])), "validation_groups": sorted(set(val["template_group"])),
    }, ensure_ascii=False, indent=1), encoding="utf-8")

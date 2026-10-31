"""
Fine-tunes a pretrained multilingual transformer LOCALLY on the CPU for 7-label moderation.

    python training/train_transformer.py [--epochs 4]

Base model: distilbert-base-multilingual-cased (Hugging Face), downloaded once into
models/pretrained/. This is a locally FINE-TUNED pretrained model, not a model trained from scratch:
the pretrained weights were learned by its authors on Wikipedia in 104 languages (including Hindi and
Gujarati); we only adapt them to our labels. Romanized Hindi/Gujarati is barely present in that
pretraining data.

- Weighted cross-entropy (class imbalance), AdamW, linear warmup/decay, dynamic padding.
- The epoch with the best validation macro F1 is kept. Saves models/transformer/.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import f1_score
from torch.utils.data import DataLoader
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training.data import LABEL_ORDER, MODELS, SEED, group_split, load_dataset  # noqa: E402

BASE = MODELS / "pretrained" / "distilbert-base-multilingual-cased"
OUT = MODELS / "transformer"
MAX_LEN = 128


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def batches(texts, labels, tokenizer, batch_size, shuffle):
    data = list(zip(texts, labels))

    def collate(items):
        enc = tokenizer([t for t, _ in items], truncation=True, max_length=MAX_LEN, padding=True, return_tensors="pt")
        enc["labels"] = torch.tensor([y for _, y in items])
        return enc

    return DataLoader(data, batch_size=batch_size, shuffle=shuffle, collate_fn=collate)


@torch.no_grad()
def predict(model, tokenizer, texts, batch_size=32):
    model.eval()
    out = []
    for i in range(0, len(texts), batch_size):
        enc = tokenizer(texts[i:i + batch_size], truncation=True, max_length=MAX_LEN, padding=True, return_tensors="pt")
        out.append(torch.softmax(model(**enc).logits, dim=-1).numpy())
    return np.concatenate(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--threads", type=int, default=max(1, (torch.get_num_threads() or 4) - 2))
    args = parser.parse_args()

    if not (BASE / "config.json").exists():
        raise SystemExit(f"Pretrained model not found in {BASE}. See README: download it once with huggingface_hub.")
    torch.set_num_threads(args.threads)
    set_seed(SEED)

    df = load_dataset()
    train, val, _ = group_split(df)
    label_to_id = {l: i for i, l in enumerate(LABEL_ORDER)}
    y_train = [label_to_id[l] for l in train["label"]]
    y_val = [label_to_id[l] for l in val["label"]]

    tokenizer = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE, num_labels=len(LABEL_ORDER), id2label=dict(enumerate(LABEL_ORDER)), label2id=label_to_id)

    counts = np.bincount(y_train, minlength=len(LABEL_ORDER)).astype(float)
    weights = torch.tensor(len(y_train) / (len(LABEL_ORDER) * np.maximum(counts, 1)), dtype=torch.float)
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)

    loader = batches(list(train["norm"]), y_train, tokenizer, args.batch_size, shuffle=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total_steps = len(loader) * args.epochs
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.1 * total_steps), total_steps)

    print(f"Fine-tuning {BASE.name} on CPU ({args.threads} threads): {len(train)} train / {len(val)} validation, "
          f"{args.epochs} epochs x {len(loader)} steps")
    best, history, started = None, [], time.time()
    for epoch in range(1, args.epochs + 1):
        model.train()
        running = 0.0
        for step, batch in enumerate(loader, start=1):
            labels = batch.pop("labels")
            loss = loss_fn(model(**batch).logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            running += loss.item()
            if step % 25 == 0:
                print(f"  epoch {epoch} step {step}/{len(loader)} loss={running / step:.4f} ({time.time() - started:.0f}s)", flush=True)
        probs = predict(model, tokenizer, list(val["norm"]))
        macro = f1_score(y_val, probs.argmax(1), average="macro", zero_division=0)
        history.append({"epoch": epoch, "train_loss": round(running / len(loader), 4), "validation_macro_f1": round(macro, 4)})
        print(f"Epoch {epoch}: train loss {running / len(loader):.4f}, validation macro-F1 {macro:.3f} ({time.time() - started:.0f}s)", flush=True)
        if best is None or macro > best:
            best = macro
            OUT.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(OUT)
            tokenizer.save_pretrained(OUT)

    (OUT / "metadata.json").write_text(json.dumps({
        "name": "distilbert-multilingual-finetuned", "base_model": "distilbert/distilbert-base-multilingual-cased",
        "fine_tuned_locally": True, "trained_from_scratch": False, "max_length": MAX_LEN, "epochs": args.epochs,
        "batch_size": args.batch_size, "learning_rate": args.lr, "labels": LABEL_ORDER, "history": history,
        "best_validation_macro_f1": round(best, 4), "train_rows": len(train),
        "train_minutes": round((time.time() - started) / 60, 1), "device": "cpu",
    }, indent=2), encoding="utf-8")
    print(f"Saved best checkpoint (validation macro-F1 {best:.3f}) to {OUT} in {(time.time() - started) / 60:.1f} min")


if __name__ == "__main__":
    main()

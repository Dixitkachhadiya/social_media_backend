"""
Local multilingual moderation: model + word list + publishing policy. No external AI APIs.

Used by the FastAPI service (inference/service.py) and by evaluation/evaluate.py, so the reported
metrics describe exactly what the service does.

Decisions
  allow      CLEAN content.
  block      Any of MILD_PROFANITY, VULGAR, PERSONAL_ABUSE, HARASSMENT, HATE_SPEECH, THREAT
             (project policy: every non-clean category is blocked until the user edits the text).
  uncertain  The model leans toward toxic but is below the block threshold and no listed word was
             found. Treated as blocked by the backend with a "please rephrase" message, so questionable
             content is never silently approved.

Signals
  word list  high precision; gives positions for highlighting.
  model      7-class classifier (fine-tuned DistilBERT-multilingual or TF-IDF baseline, see deployment.json).
  Texts under 3 words are judged by the word list only (model scores on very short text are unreliable).
"""
from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from preprocessing.language import detect_language  # noqa: E402
from preprocessing.lexicon import SEVERITY_RANK, compile_lexicon, find_matches, is_addressed, tokenize, utf16_offset  # noqa: E402
from preprocessing.normalize import normalize  # noqa: E402

MODELS = ROOT / "models"
LABELS = ["CLEAN", "MILD_PROFANITY", "VULGAR", "PERSONAL_ABUSE", "HARASSMENT", "HATE_SPEECH", "THREAT"]
SERIOUS = {"HARASSMENT", "HATE_SPEECH", "THREAT"}
CATEGORY_SEVERITY = {"CLEAN": "none", "MILD_PROFANITY": "low", "VULGAR": "medium", "PERSONAL_ABUSE": "medium",
                     "HARASSMENT": "high", "HATE_SPEECH": "high", "THREAT": "high"}
EXPLANATIONS = {
    "MILD_PROFANITY": "The text contains mild profanity.",
    "VULGAR": "The text contains vulgar or sexual language.",
    "PERSONAL_ABUSE": "The text insults or demeans a person.",
    "HARASSMENT": "The text harasses or degrades a person (including slurs or encouraging self-harm).",
    "HATE_SPEECH": "The text attacks or dehumanizes a group of people.",
    "THREAT": "The text threatens violence or harm.",
}
DISPLAY = {"MILD_PROFANITY": "Mild profanity", "VULGAR": "Vulgar language", "PERSONAL_ABUSE": "Personal abuse",
           "HARASSMENT": "Harassment", "HATE_SPEECH": "Hate speech", "THREAT": "Threatening language", "CLEAN": "Clean"}
MIN_WORDS_FOR_MODEL = 3
SERIOUS_ESCALATION = 0.7
DEFAULT_THRESHOLDS = {"block": 0.8, "uncertain": 0.6}


class Moderator:
    def __init__(self, models_dir: Path = MODELS, model_kind: str | None = None, thresholds: dict | None = None,
                 lexicon_entries: list[dict] | None = None):
        """lexicon_entries overrides models/lexicon.json (evaluation uses a training-split-only word list)."""
        deployment_file = models_dir / "deployment.json"
        deployment = json.loads(deployment_file.read_text(encoding="utf-8")) if deployment_file.exists() else {}
        self.kind = model_kind or deployment.get("model", "baseline")
        self.thresholds = {**DEFAULT_THRESHOLDS, **deployment.get("thresholds", {}), **(thresholds or {})}
        self.version = deployment.get("version", "untuned")
        if lexicon_entries is None:
            lexicon_entries = json.loads((models_dir / "lexicon.json").read_text(encoding="utf-8"))["entries"]
        self.lexicon = compile_lexicon(lexicon_entries)
        self._lock = threading.Lock()

        if self.kind == "transformer":
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            self._torch = torch
            path = models_dir / "transformer"
            self.tokenizer = AutoTokenizer.from_pretrained(path)
            self.model = AutoModelForSequenceClassification.from_pretrained(path).eval()
            self.labels = [self.model.config.id2label[i] for i in range(self.model.config.num_labels)]
            self.name = "distilbert-multilingual-finetuned"
        elif self.kind == "baseline":
            import joblib

            self.pipeline = joblib.load(models_dir / "baseline" / "model.joblib")
            self.labels = list(self.pipeline.classes_)
            self.name = "tfidf-char-logreg"
        else:
            raise ValueError(f"Unknown model kind: {self.kind}")
        if sorted(self.labels) != sorted(LABELS):
            raise ValueError(f"Model labels {self.labels} do not match {LABELS}")

    # ------------------------------------------------------------------ model
    def probabilities(self, normalized_texts: list[str]) -> list[dict]:
        if self.kind == "baseline":
            rows = self.pipeline.predict_proba(normalized_texts)
        else:
            torch = self._torch
            with self._lock, torch.no_grad():
                enc = self.tokenizer(normalized_texts, truncation=True, max_length=128, padding=True, return_tensors="pt")
                rows = torch.softmax(self.model(**enc).logits, dim=-1).numpy()
        return [{label: float(p) for label, p in zip(self.labels, row)} for row in rows]

    # ------------------------------------------------------------------ policy
    def moderate(self, text: str, probs: dict | None = None) -> dict:
        started = time.perf_counter()
        normalized = normalize(text)
        words = len(normalized.split()) if normalized else 0
        probs = probs or (self.probabilities([normalized])[0] if normalized else {label: float(label == "CLEAN") for label in LABELS})
        p_toxic = 1.0 - probs["CLEAN"]
        model_category, model_p = max(((l, p) for l, p in probs.items() if l != "CLEAN"), key=lambda x: x[1])
        block_t, uncertain_t = self.thresholds["block"], self.thresholds["uncertain"]

        matches = find_matches(text, self.lexicon, p_toxic=p_toxic, context_threshold=block_t)
        signals = []
        if matches:
            strongest = max(matches, key=lambda m: (SEVERITY_RANK[m["entry"]["severity"]], m["entry"]["category"] in SERIOUS))
            category, severity = strongest["entry"]["category"], strongest["entry"]["severity"]
            if category in ("MILD_PROFANITY", "VULGAR") and is_addressed(tokenize(text)):
                category, severity = "PERSONAL_ABUSE", max(severity, "medium", key=SEVERITY_RANK.get)
            serious = next((m for m in matches if m["entry"]["category"] in SERIOUS), None)
            if serious:
                category = serious["entry"]["category"]
                severity = max(severity, serious["entry"]["severity"], key=SEVERITY_RANK.get)
            if model_category in SERIOUS and model_p >= SERIOUS_ESCALATION and severity != "high":
                category, severity = model_category, "high"
            decision = "block"
            signals = ["word_list"] + (["model"] if p_toxic >= block_t else [])
        elif words >= MIN_WORDS_FOR_MODEL and p_toxic >= block_t:
            decision, category, severity, signals = "block", model_category, CATEGORY_SEVERITY[model_category], ["model"]
        elif words >= MIN_WORDS_FOR_MODEL and p_toxic >= uncertain_t:
            decision, category, severity, signals = "uncertain", model_category, CATEGORY_SEVERITY[model_category], ["model"]
        else:
            decision, category, severity = "allow", "CLEAN", "none"

        language = detect_language(text)
        flagged = [{
            "text": m["text"],
            "start": utf16_offset(text, m["start"]),
            "end": utf16_offset(text, m["end"]),
            "category": m["entry"]["category"],
        } for m in matches]

        if decision == "allow":
            explanation = "No inappropriate language was detected."
        elif decision == "uncertain":
            explanation = ("The content could not be verified as appropriate. It may contain "
                           f"{DISPLAY[category].lower()}. Please rephrase it.")
        else:
            terms = ", ".join(dict.fromkeys(f'"{f["text"]}"' for f in flagged))
            explanation = EXPLANATIONS[category] + (f" Flagged: {terms}." if terms else " No specific words could be highlighted.")

        return {
            "decision": decision,
            "blocked": decision != "allow",
            "is_toxic": True if decision == "block" else (None if decision == "uncertain" else False),
            "category": category,
            "category_label": DISPLAY[category],
            "severity": severity,
            "confidence": round(p_toxic if decision != "allow" else 1 - p_toxic, 3),
            "detected_language": language["name"],
            "language_code": language["code"],
            "flagged_terms": flagged,
            "explanation": explanation,
            "signals": signals,
            "model": {"name": self.name, "version": self.version},
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }

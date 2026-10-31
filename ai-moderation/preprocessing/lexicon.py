"""
Word/phrase list matching with positions in the ORIGINAL text (used to highlight offending terms).

- A term matches when its normalized tokens appear as consecutive tokens of the text.
- Tokens are compared by a key that squeezes repeated letters (fuuuck -> fuck) unless fewer than
  4 characters would remain (so "ass" never matches "as").
- Masked words ("s*it", "d1ck*ead", "f**k") match through a wildcard: each run of * = 1-2 letters.
- Runs of 4+ single letters ("f u c k") are merged.
- Context-dependent terms (dog, owl, brother-in-law...) only count when the text addresses someone
  directly or the classifier is already confident the text is toxic.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .normalize import LEET, SECOND_PERSON, normalize

SQUEEZE = re.compile(r"(.)\1+", re.DOTALL)
RAW_TOKEN = re.compile("[^ \t\n\r\f\v   ]+")
SINGLE_LATIN = re.compile(r"^[a-z]$")
EDGE_PUNCT = ".,;:?!\"'()[]{}…।॥“”‘’-"
SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}


def token_key(token: str) -> str:
    squeezed = SQUEEZE.sub(r"\1", token)
    return squeezed if len(squeezed) >= 4 else token


def _mask_pattern(raw: str):
    word = "".join(LEET.get(ch, ch) for ch in unicodedata.normalize("NFKC", raw).lower())
    if not re.search(r"[a-z]\*+|\*+[a-z]", word) or not re.fullmatch(r"[a-z*]+", word):
        return None
    if len(word.replace("*", "")) < 2:
        return None
    return re.compile("^" + re.sub(r"\*+", "[a-z]{1,2}", word) + "$")


@dataclass
class Token:
    norm: str
    start: int
    end: int
    key: str
    pattern: re.Pattern | None = None


def tokenize(text: str) -> list[Token]:
    raw_tokens = []
    for m in RAW_TOKEN.finditer(text):
        raw = m.group(0)
        lead = len(raw) - len(raw.lstrip(EDGE_PUNCT))
        trail = len(raw) - len(raw.rstrip(EDGE_PUNCT))
        if lead == len(raw):
            continue
        start, end = m.start() + lead, m.end() - trail
        pattern = _mask_pattern(text[start:end])
        parts = [p for p in normalize(raw).split(" ") if p]
        for part in parts:
            raw_tokens.append((part, start, end, pattern if len(parts) == 1 else None))

    merged: list[Token] = []
    i = 0
    while i < len(raw_tokens):
        j = i
        while j < len(raw_tokens) and SINGLE_LATIN.match(raw_tokens[j][0]):
            j += 1
        if j - i >= 4:
            norm = "".join(t[0] for t in raw_tokens[i:j])
            merged.append(Token(norm, raw_tokens[i][1], raw_tokens[j - 1][2], token_key(norm)))
            i = j
        else:
            norm, start, end, pattern = raw_tokens[i]
            merged.append(Token(norm, start, end, token_key(norm), pattern))
            i += 1
    return merged


def compile_lexicon(entries: list[dict]) -> list[dict]:
    compiled = []
    for e in entries:
        norms = [t for t in normalize(e["term"]).split(" ") if t]
        if norms:
            compiled.append({**e, "norms": norms, "keys": [token_key(t) for t in norms]})
    # Longer phrases first so "fuck you" wins over "fuck" at the same position
    compiled.sort(key=lambda e: -len(e["keys"]))
    return compiled


def is_addressed(tokens: list[Token]) -> bool:
    return any(t.norm in SECOND_PERSON for t in tokens)


def find_matches(text: str, compiled: list[dict], p_toxic: float = 0.0, context_threshold: float = 0.7) -> list[dict]:
    """Returns [{entry, start, end, text}] (non-overlapping, Python string indices)."""
    tokens = tokenize(text)
    addressed = is_addressed(tokens)
    used = [False] * len(tokens)
    matches = []
    for entry in compiled:
        if entry.get("context_dependent") and not (addressed or p_toxic >= context_threshold):
            continue
        n = len(entry["keys"])
        for i in range(len(tokens) - n + 1):
            ok = True
            for k in range(n):
                tok = tokens[i + k]
                same = tok.key == entry["keys"][k] or (tok.pattern is not None and tok.pattern.match(entry["norms"][k]))
                if used[i + k] or not same:
                    ok = False
                    break
            if not ok:
                continue
            for k in range(n):
                used[i + k] = True
            start, end = tokens[i].start, tokens[i + n - 1].end
            matches.append({"entry": entry, "start": start, "end": end, "text": text[start:end]})
    return sorted(matches, key=lambda m: m["start"])


def utf16_offset(text: str, index: int) -> int:
    """Converts a Python (code point) index to a JavaScript (UTF-16) index for highlighting."""
    return len(text[:index].encode("utf-16-le")) // 2

"""
Text normalization shared by training (Python) and inference (Node.js).

The JavaScript port lives in Backend/src/moderation/normalize.js and MUST produce identical output;
models/parity_fixtures.json (written by train.py) is checked by the Jest suite to guarantee it.
Only operations with identical semantics in both languages are used: NFKC, lower-casing of Latin /
Devanagari / Gujarati text, explicit character classes, and Unicode category checks.
"""
import re
import unicodedata

ZERO_WIDTH = re.compile("[​-‏⁠﻿]")
LEET = {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"}
HAS_LATIN = re.compile("[a-z]")
# One explicit whitespace class, identical in normalize.js (Python's \s and JS's \s differ slightly;
# after NFKC the other Unicode spaces have already become U+0020)
WS = " \t\n\r\f\v   "
WS_CLASS = "[" + WS + "]"
NON_WS_CLASS = "[^" + WS + "]"
# Leet characters inside a token that contains at least one Latin letter: "sh!t", "ch0d", "b1tch"
TOKEN = re.compile(NON_WS_CLASS + "+")
# "f*ck" -> "fck" (stars between Latin letters)
STAR_BETWEEN_LETTERS = re.compile(r"(?<=[a-z])\*+(?=[a-z])")
# "f u c k", "b.h.e.n" -> joined when 4+ single Latin letters are separated by spaces . - _
SPACED_LETTERS = re.compile(r"(?<!" + NON_WS_CLASS + r")(?:[a-z][ .\-_]+){3,}[a-z](?!" + NON_WS_CLASS + ")")
SPACED_SEPARATORS = re.compile(r"[ .\-_]+")
REPEATS = re.compile(r"(.)\1{2,}", re.DOTALL)
WHITESPACE = re.compile(WS_CLASS + "+")


def _is_kept(ch: str) -> bool:
    """Letters, combining marks (Hindi/Gujarati vowel signs), numbers and whitespace are kept."""
    if ch in WS:
        return True
    return unicodedata.category(ch)[0] in ("L", "M", "N")


def _leet_token(token: str) -> str:
    if not HAS_LATIN.search(token):
        return token
    return "".join(LEET.get(ch, ch) for ch in token)


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "")
    t = ZERO_WIDTH.sub("", t)
    t = t.lower()
    t = TOKEN.sub(lambda m: _leet_token(m.group(0)), t)
    t = STAR_BETWEEN_LETTERS.sub("", t)
    t = SPACED_LETTERS.sub(lambda m: SPACED_SEPARATORS.sub("", m.group(0)), t)
    t = "".join(ch if _is_kept(ch) else " " for ch in t)
    t = REPEATS.sub(r"\1\1", t)
    t = WHITESPACE.sub(" ", t).strip()
    return t


# Words addressing a person directly (used to decide whether a context-dependent word is abusive)
SECOND_PERSON = {
    "you", "your", "youre", "yours", "u", "ur", "yourself",
    "tu", "tum", "tujhe", "tera", "teri", "tere", "tumhara", "tumhare", "tumhe", "aap",
    "tame", "tane", "taro", "tari", "taru", "tamne", "tamaro", "tamari", "tara",
    "abe", "oye", "ae", "saale",
    "तू", "तुम", "तुझे", "तेरा", "तेरी", "तेरे", "तुम्हारा", "तुम्हें",
    "તું", "તમે", "તને", "તારો", "તારી", "તારું", "તમારો", "તમને",
}

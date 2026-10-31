"""
Word/phrase list matching, mirrored by Backend/src/moderation/lexicon.js.

A term matches when its normalized tokens appear as consecutive tokens in the normalized text.
Tokens are compared by a "key": repeated letters are squeezed (fuuuck -> fuck) unless that would
leave fewer than 4 characters (so "ass" never matches "as"). Context-dependent terms (dog, owl,
brother-in-law...) only count when the text addresses someone directly or the classifier agrees.
"""
import re

from text_normalization import SECOND_PERSON, normalize

SQUEEZE = re.compile(r"(.)\1+", re.DOTALL)
SEVERITY_RANK = {"none": 0, "low": 1, "medium": 2, "high": 3}


def token_key(token: str) -> str:
    squeezed = SQUEEZE.sub(r"\1", token)
    return squeezed if len(squeezed) >= 4 else token


def compile_lexicon(entries):
    """entries: dicts with term, category, severity, context_dependent, replacement."""
    compiled = []
    for e in entries:
        keys = [token_key(t) for t in normalize(e["term"]).split(" ") if t]
        if keys:
            compiled.append({**e, "keys": keys})
    return compiled


def find_matches(text, compiled, p_inappropriate=0.0, context_threshold=0.5):
    tokens = [t for t in normalize(text).split(" ") if t]
    keys = [token_key(t) for t in tokens]
    addressed = any(t in SECOND_PERSON for t in tokens)
    hits = []
    for e in compiled:
        n = len(e["keys"])
        for i in range(len(keys) - n + 1):
            if keys[i:i + n] == e["keys"]:
                if e["context_dependent"] and not (addressed or p_inappropriate >= context_threshold):
                    continue
                hits.append(e)
                break
    return hits

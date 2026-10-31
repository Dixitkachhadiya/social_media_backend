"""
Lightweight language identification for English, Hindi, Gujarati and their romanized / mixed forms.
Script detection is reliable; romanized Hindi vs Gujarati is a best guess from common function words.
"""
import re

DEVANAGARI = re.compile("[ऀ-ॿ]")
GUJARATI = re.compile("[઀-૿]")
LATIN_WORD = re.compile("[a-z]+")

HINDI_HINTS = {"hai", "hain", "nahi", "nahin", "kya", "mera", "meri", "mere", "tera", "teri", "tere", "tu", "tum", "mujhe",
               "tujhe", "kar", "karo", "raha", "rahi", "gaya", "gayi", "ka", "ki", "ke", "bhi", "toh", "aur", "bahut", "accha",
               "achha", "abe", "yaar", "kal", "sab", "ho", "tha", "thi", "diya", "dunga", "lunga", "hoon", "kyun", "kaise"}
GUJARATI_HINTS = {"che", "chhe", "nathi", "tame", "tane", "maru", "taru", "maro", "taro", "shu", "kem", "aaje", "kale", "bahu",
                  "saru", "saras", "hatu", "hati", "hato", "thai", "gayu", "gayo", "karyu", "pachhu", "aavu", "mane", "ema",
                  "ane", "pan", "sav", "nakhish", "kai", "jay", "chu"}
ENGLISH_HINTS = {"the", "is", "are", "and", "you", "to", "of", "this", "that", "it", "was", "for", "with", "my", "not", "so",
                 "what", "but", "have", "just", "please", "thanks", "today", "really", "honestly", "i", "me", "we", "they",
                 "be", "can", "will", "your", "about"}

NAMES = {
    "en": "English", "hi": "Hindi", "gu": "Gujarati", "hi-Latn": "Hindi (romanized)", "gu-Latn": "Gujarati (romanized)",
    "hinglish": "Hinglish (Hindi + English)", "en-gu": "Mixed (English + Gujarati)", "mixed": "Mixed language", "unknown": "Unknown",
}


def detect_language(text: str) -> dict:
    has_dev = bool(DEVANAGARI.search(text))
    has_guj = bool(GUJARATI.search(text))
    words = LATIN_WORD.findall(text.lower())
    score = {"en": 0, "hi": 0, "gu": 0}
    for w in words:
        score["en"] += w in ENGLISH_HINTS
        score["hi"] += w in HINDI_HINTS
        score["gu"] += w in GUJARATI_HINTS

    components = []
    if has_dev:
        components.append("hi")
    if has_guj:
        components.append("gu")
    if words:
        if score["hi"] > score["gu"] and score["hi"] > 0:
            components.append("hinglish" if score["en"] > 0 else "hi-Latn")
        elif score["gu"] > 0:
            components.append("en-gu" if score["en"] > 0 else "gu-Latn")
        else:
            components.append("en")

    code = components[0] if components else "unknown"
    if len(components) > 1:
        code = "mixed"
    name = f"Mixed ({' + '.join(NAMES[c] for c in components)})" if len(components) > 1 else NAMES[code]
    return {"code": code, "name": name, "reliable": has_dev or has_guj or len(words) >= 3}

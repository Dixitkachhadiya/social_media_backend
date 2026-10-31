"""
Generates the SYNTHETIC multilingual vulgar-content dataset as an Excel workbook.

    python dataset/generate_dataset.py

Output: dataset/multilingual_vulgar_content_dataset.xlsx with 10 sheets (English, Hindi, Gujarati,
Hinglish, Hindi romanized, Gujarati romanized, Mixed language, Clean conversations, Criticism and
negative opinions, Statistics).

Every row is synthetic (source_type starts with "synthetic"), contains no real people or private data,
and hate examples only refer to generic groups. This data is NOT sufficient for reliable real-world
moderation; see dataset/README.md.
"""
from __future__ import annotations

import sys
from collections import OrderedDict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import templates as T  # noqa: E402
from preprocessing.lexicon import compile_lexicon, find_matches  # noqa: E402

OUTPUT = ROOT / "dataset" / "multilingual_vulgar_content_dataset.xlsx"

CATEGORIES = ["Clean", "Mild profanity", "Vulgar language", "Personal abuse", "Harassment", "Hate speech", "Threatening language"]
COLUMNS = ["id", "text", "language", "script", "category", "severity", "is_toxic", "target_type", "explanation", "source_type",
           "flagged_terms", "clean_counterpart", "context_dependent", "obfuscation", "template_group"]

# Extra natural mild-profanity sentences (low severity), so "mild" is not only learned from odd templates
MILD_TEMPLATES = {
    "en": [
        ("mild-damn", "Damn, {t} got postponed again.", "Ugh, {t} got postponed again."),
        ("mild-crap", "{t} was crap honestly, total waste of time.", "{t} was poor honestly, total waste of time."),
        ("mild-oh", "Oh crap, I completely forgot about {t}.", "Oh no, I completely forgot about {t}."),
        ("mild-hell", "What the hell is going on with {t}?", "What is going on with {t}?"),
        ("mild-bs", "That excuse about {t} is total bullshit.", "That excuse about {t} is total nonsense."),
        ("mild-shit", "Shit, I missed {t} again.", "Oops, I missed {t} again."),
    ],
    "hi-Latn": [
        ("mild-saala", "Saala {t} phir se cancel ho gaya.", "{t} phir se cancel ho gaya."),
        ("mild-dhat", "Dhat teri ki, {t} bhool gaya main.", "Arre, {t} bhool gaya main."),
    ],
    "hinglish": [
        ("mild-damn", "Damn yaar, {t} phir se late hai.", "Yaar, {t} phir se late hai."),
        ("mild-shit", "Shit bro, {t} ka deadline aaj hi tha.", "Oh no bro, {t} ka deadline aaj hi tha."),
    ],
    "gu-Latn": [
        ("mild-saala", "Saala {t} pachhu cancel thai gayu.", "{t} pachhu cancel thai gayu."),
    ],
}
T.term("hell", ["hel"], "en", "", "profanity", "low", "", "Mild profanity in exclamations ('what the hell').", context=True)
T.term("dhat teri ki", ["dhat tere ki"], "hi-Latn", "dhat teri ki", "profanity", "low", "", "Mild exclamation of annoyance.")

# The f-word family is vulgar (not mild) in this project's taxonomy
for _entry in T.L:
    if _entry["term"] in {"fucking", "what the fuck", "fucked up"}:
        _entry["severity"] = "medium"

# Non-targeted vulgar language (strong profanity, not aimed at anyone): (id, template, clean counterpart)
VULGAR_TEMPLATES = {
    "en": [
        ("vulgar-traffic", "This fucking traffic made me late for {t}.", "This terrible traffic made me late for {t}."),
        ("vulgar-wtf", "What the fuck is wrong with {t} today?", "What on earth is wrong with {t} today?"),
        ("vulgar-fucked", "{t} is completely fucked up now.", "{t} is completely messed up now."),
        ("vulgar-shitshow", "{t} turned into a total shitshow.", "{t} turned into a total mess."),
        ("vulgar-fuck-this", "Fuck this, {t} is never going to work.", "Forget it, {t} is never going to work."),
    ],
    "hi-Latn": [
        ("vulgar-bc", "Bhenchod, {t} phir se atak gaya.", "Arre yaar, {t} phir se atak gaya."),
        ("vulgar-mc", "Madarchod ye {t} kabhi time pe nahi hota.", "Ye {t} kabhi time pe nahi hota."),
        ("vulgar-lavde", "Lavde lag gaye, {t} ka pura kaam dobara karna padega.", "Mushkil ho gayi, {t} ka pura kaam dobara karna padega."),
    ],
    "hinglish": [
        ("vulgar-bro", "Bro this fucking {t} is so annoying yaar.", "Bro this {t} is so annoying yaar."),
        ("vulgar-bc", "Bhenchod {t} again cancelled, what a joke.", "Ugh, {t} again cancelled, what a joke."),
    ],
    "gu-Latn": [
        ("vulgar-lodo", "Lodo, {t} pachhu atki gayu.", "Arre, {t} pachhu atki gayu."),
        ("vulgar-bc", "Bhenchod aa {t} kyare puru thase?", "Aa {t} kyare puru thase?"),
    ],
    "hi": [
        ("vulgar-bc", "बहनचोद, {t} फिर से अटक गया।", "अरे यार, {t} फिर से अटक गया।"),
        ("vulgar-mc", "मादरचोद ये {t} कभी समय पर नहीं होता।", "ये {t} कभी समय पर नहीं होता।"),
    ],
    "gu": [
        ("vulgar-lodo", "લોડો, {t} પાછું અટકી ગયું.", "અરે, {t} પાછું અટકી ગયું."),
    ],
}


def build_vulgar():
    rows = []
    for lang, templates in VULGAR_TEMPLATES.items():
        for tid, tpl, clean in templates:
            for t in T.rng.sample(T.TOPICS[lang], 5):
                word_tpl, obf = tpl, "none"
                rows.append(dict(text=word_tpl.format(t=t), language_code=lang, category="profanity", severity="medium",
                                 is_inappropriate=True, safe_rewritten_text=clean.format(t=t),
                                 explanation="Strong vulgar language, not aimed at a specific person.",
                                 obfuscation=obf, template_group=f"{lang}:{tid}"))
    for r in rows:
        r["language"], r["script"] = T.LANG[r["language_code"]]
    return rows


def new_category(old: str, severity: str) -> str:
    if old == "clean":
        return "Clean"
    if old == "profanity":
        return "Mild profanity" if severity == "low" else "Vulgar language"
    return {"insult": "Personal abuse", "harassment": "Harassment", "threat": "Threatening language", "hate": "Hate speech"}[old]


def new_severity(category: str, old_severity: str) -> str:
    base = {"Clean": "none", "Mild profanity": "low", "Vulgar language": "medium", "Personal abuse": "medium",
            "Harassment": "high", "Hate speech": "high", "Threatening language": "high"}[category]
    if category in ("Vulgar language", "Personal abuse") and old_severity == "high":
        return "high"
    return base


def target_type(category: str) -> str:
    return {"Clean": "none", "Mild profanity": "none", "Vulgar language": "none", "Personal abuse": "individual",
            "Harassment": "individual", "Threatening language": "individual", "Hate speech": "group"}[category]


def build_mild():
    rows = []
    for lang, templates in MILD_TEMPLATES.items():
        for tid, tpl, clean in templates:
            for t in T.rng.sample(T.TOPICS[lang], 5):
                rows.append(dict(text=tpl.format(t=t), language_code=lang, category="profanity", severity="low",
                                 is_inappropriate=True, safe_rewritten_text=clean.format(t=t),
                                 explanation="Mild profanity used as an exclamation, not aimed at anyone.",
                                 obfuscation="none", template_group=f"{lang}:{tid}"))
    for r in rows:
        r["language"], r["script"] = T.LANG[r["language_code"]]
    return rows


def convert(rows, source_type, lexicon):
    out = []
    for r in rows:
        old_cat = r["category"]
        old_sev = str(r.get("severity") or "none")
        category = new_category(old_cat, old_sev)
        matches = find_matches(r["text"], lexicon, p_toxic=1.0 if category != "Clean" else 0.0) if category != "Clean" else []
        out.append({
            "text": r["text"],
            "language": r["language"],
            "language_code": r["language_code"],
            "script": r["script"],
            "category": category,
            "severity": new_severity(category, old_sev),
            "is_toxic": category != "Clean",
            "target_type": target_type(category),
            "explanation": r.get("explanation", ""),
            "source_type": source_type if "subcategory" not in r else f"{source_type} ({r['subcategory']})",
            "flagged_terms": ", ".join(dict.fromkeys(m["text"] for m in matches)),
            "clean_counterpart": r.get("safe_rewritten_text") or "",
            "context_dependent": bool(r.get("context_dependent", False)),
            "obfuscation": r.get("obfuscation") or "none",
            "template_group": r["template_group"],
        })
    return out


CRITICISM_KINDS = {"criticism", "disagreement", "negative-emotion"}
TOXIC_SHEETS = {"en": "1 English", "hi": "2 Hindi", "gu": "3 Gujarati", "hinglish": "4 Hinglish",
                "hi-Latn": "5 Hindi romanized", "gu-Latn": "6 Gujarati romanized"}
SHEET_NAMES = ["1 English", "2 Hindi", "3 Gujarati", "4 Hinglish", "5 Hindi romanized", "6 Gujarati romanized",
               "7 Mixed language", "8 Clean conversations", "9 Criticism and opinions"]


def sheet_for(row) -> str:
    code = row["language_code"]
    if code not in TOXIC_SHEETS:
        return "7 Mixed language"
    if row["is_toxic"]:
        return TOXIC_SHEETS[code]
    if "(criticism" in row["source_type"] or "(disagreement" in row["source_type"] or "(negative-emotion" in row["source_type"]:
        return "9 Criticism and opinions"
    if code == "hinglish":
        return "4 Hinglish"
    return "8 Clean conversations"


def main():
    lexicon = compile_lexicon([dict(term=e["term"], category=e["category"], severity=e["severity"],
                                    context_dependent=e["context"]) for e in T.L for e in
                               [e] + [dict(e, term=v) for v in e["variants"]]])
    rows = []
    rows += convert(T.dedupe(T.build_words()), "synthetic: word list", lexicon)
    rows += convert(T.dedupe(T.build_sentences()), "synthetic: template", lexicon)
    rows += convert(T.dedupe(build_mild()), "synthetic: template", lexicon)
    rows += convert(T.dedupe(build_vulgar()), "synthetic: template", lexicon)
    rows += convert(T.dedupe(T.build_clean()), "synthetic: template", lexicon)
    rows += convert(T.dedupe(T.build_mixed()), "synthetic: template", lexicon)
    for r in rows:
        if r["template_group"].split(":")[1].startswith("generic-") or "generic" in r["template_group"]:
            r["source_type"] = r["source_type"].replace("template", "handwritten")
        if r["template_group"].startswith("word:"):
            r["source_type"] = "synthetic: word list"

    # Exact duplicates across builders are dropped (case/space-insensitive)
    seen, unique = set(), []
    for r in rows:
        key = " ".join(r["text"].lower().split())
        if key not in seen:
            seen.add(key)
            unique.append(r)

    sheets = OrderedDict((name, []) for name in SHEET_NAMES)
    for r in unique:
        sheets[sheet_for(r)].append(r)

    frames = OrderedDict()
    prefix = 0
    for name, items in sheets.items():
        prefix += 1
        df = pd.DataFrame(items)
        df.insert(0, "id", [f"S{prefix:02d}-{i:05d}" for i in range(1, len(df) + 1)])
        frames[name] = df[COLUMNS + ["language_code"]]

    all_rows = pd.concat([df.assign(sheet=name) for name, df in frames.items()], ignore_index=True)
    stats = [("Total", "total examples", len(all_rows))]
    stats += [("Rows per sheet", name, len(df)) for name, df in frames.items()]
    stats += [("Toxic vs clean", "toxic" if k else "clean", int(v)) for k, v in all_rows["is_toxic"].value_counts().items()]
    stats += [("Examples per language", k, int(v)) for k, v in all_rows["language"].value_counts().items()]
    stats += [("Examples per script", k, int(v)) for k, v in all_rows["script"].value_counts().items()]
    stats += [("Examples per category", c, int((all_rows["category"] == c).sum())) for c in CATEGORIES]
    stats += [("Examples per severity", k, int(v)) for k, v in all_rows["severity"].value_counts().items()]
    stats += [("Examples per target type", k, int(v)) for k, v in all_rows["target_type"].value_counts().items()]
    stats += [("Obfuscation", k, int(v)) for k, v in all_rows["obfuscation"].value_counts().items()]
    stats += [("Source type", k, int(v)) for k, v in all_rows["source_type"].str.split(" \\(").str[0].value_counts().items()]
    stats.append(("Note", f"All rows are SYNTHETIC (template/handwritten for this project, seed {T.SEED}). "
                          "They do not represent real-world language use and are not sufficient for reliable moderation.", ""))
    frames["10 Statistics"] = pd.DataFrame(stats, columns=["section", "item", "count"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(OUTPUT, engine="openpyxl") as writer:
        for name, df in frames.items():
            df.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            ws.freeze_panes = "A2"
            for col in ws.columns:
                width = min(60, max(10, max(len(str(c.value or "")) for c in col[:200]) + 2))
                ws.column_dimensions[col[0].column_letter].width = width

    print(f"Wrote {OUTPUT}")
    for name, df in frames.items():
        print(f"  {name}: {len(df)} rows")


if __name__ == "__main__":
    main()

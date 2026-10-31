"""
Generates the SYNTHETIC multilingual content moderation dataset as an Excel workbook.

    python scripts/generate_dataset.py

Output: datasets/multilingual_content_moderation_dataset.xlsx with sheets
  1. Vulgar Words, 2. Vulgar Sentences, 3. Clean Content, 4. Mixed Language, 5. Statistics

Every row is synthetic (generated from templates written for this project), marked synthetic=True,
and contains no real people or private information. Hate examples only refer to generic groups.
Hindi/Gujarati slang must be reviewed by native speakers before relying on it (see datasets/README.md).

Columns beyond the requested ones:
  template_group  rows generated from the same template share a group; the training split keeps a
                  group entirely in train, validation OR test, so near-duplicates never leak.
  obfuscation     none | leet | spaced | repeated | star  (how the abusive word was disguised)
  synthetic       always True
"""
from __future__ import annotations

import random
from collections import OrderedDict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "datasets" / "multilingual_content_moderation_dataset.xlsx"
SEED = 20261031
rng = random.Random(SEED)

# ---------------------------------------------------------------------------------------------
# Languages: code -> (display name, script)
# ---------------------------------------------------------------------------------------------
LANG = {
    "en": ("English", "Latin"),
    "hi": ("Hindi", "Devanagari"),
    "hi-Latn": ("Hindi (romanized)", "Latin"),
    "gu": ("Gujarati", "Gujarati"),
    "gu-Latn": ("Gujarati (romanized)", "Latin"),
    "hinglish": ("Hinglish", "Latin"),
    "en-gu": ("Mixed (English + Gujarati)", "Latin"),
    "en-hi-gu": ("Mixed (English + Hindi + Gujarati)", "Mixed"),
    "en-hi-script": ("Mixed (English + Hindi script)", "Mixed"),
    "en-gu-script": ("Mixed (English + Gujarati script)", "Mixed"),
}

SEVERITY_BY_CATEGORY = {"clean": "none", "profanity": "low", "insult": "medium", "harassment": "high", "threat": "high", "hate": "high"}

# ---------------------------------------------------------------------------------------------
# Sheet 1 lexicon: (term, variants, lang, transliteration, category, severity, replacement,
#                   context_dependent, explanation)
# context_dependent=True: the word has an ordinary meaning (dog, owl, brother-in-law...) and is only
# abusive when aimed at someone. The Node engine only flags it next to a second-person marker or when
# the classifier agrees.
# ---------------------------------------------------------------------------------------------
L = []


def term(t, variants, lang, translit, category, severity, replacement, explanation, context=False):
    L.append(dict(term=t, variants=variants, lang=lang, translit=translit, category=category, severity=severity,
                  replacement=replacement, context=context, explanation=explanation))


# English
term("fuck", ["fuk", "fck", "fuq", "phuck", "fuc"], "en", "", "profanity", "medium", "", "Strong profanity used as an intensifier or curse.")
term("fucking", ["fuking", "fcking", "fukin", "phucking", "fkin"], "en", "", "profanity", "low", "really", "Profane intensifier.")
term("what the fuck", ["wtf"], "en", "", "profanity", "low", "what on earth", "Profane exclamation.")
term("fuck off", ["fuk off", "fck off"], "en", "", "insult", "medium", "please leave me alone", "Hostile dismissal aimed at a person.")
term("fuck you", ["fuk you", "fck you", "fuck u", "fk u"], "en", "", "insult", "medium", "I am very upset with you", "Direct abusive curse at a person.")
term("fucked up", ["fked up", "fuked up"], "en", "", "profanity", "low", "messed up", "Profane description.")
term("shit", ["sh1t", "shiit", "shyt"], "en", "", "profanity", "low", "rubbish", "Common profanity.")
term("bullshit", ["bs", "bullsh1t", "bullshyt"], "en", "", "profanity", "low", "nonsense", "Profane word for nonsense.")
term("piece of shit", ["pos"], "en", "", "insult", "medium", "terrible person", "Degrading insult aimed at a person.")
term("damn", ["dammit", "damnit"], "en", "", "profanity", "low", "", "Mild profanity.")
term("crap", ["crappy"], "en", "", "profanity", "low", "poor", "Mild profanity.")
term("bitch", ["b1tch", "biatch", "bich", "bitchy"], "en", "", "insult", "medium", "rude person", "Gendered insult aimed at a person.")
term("bastard", ["basterd", "b4stard"], "en", "", "insult", "medium", "rude person", "Insult aimed at a person.")
term("asshole", ["a$$hole", "assh0le", "arsehole", "ahole"], "en", "", "insult", "medium", "rude person", "Insult aimed at a person.")
term("dickhead", ["dikhead", "d1ckhead"], "en", "", "insult", "medium", "rude person", "Insult aimed at a person.")
term("idiot", ["idiat", "1diot", "idot"], "en", "", "insult", "low", "careless person", "Mild insult; criticism of ideas is not flagged.", context=True)
term("moron", ["m0ron", "moran"], "en", "", "insult", "medium", "careless person", "Insult questioning someone's intelligence.")
term("dumbass", ["dumass", "dumb ass"], "en", "", "insult", "medium", "careless person", "Insult aimed at a person.")
term("jerk", ["jurk"], "en", "", "insult", "low", "rude person", "Mild insult.", context=True)
term("loser", ["l0ser", "looser"], "en", "", "insult", "low", "person", "Belittling insult.", context=True)
term("scumbag", ["scum bag", "scum"], "en", "", "insult", "medium", "dishonest person", "Degrading insult.")
term("slut", ["sl*t", "slutt"], "en", "", "harassment", "high", "person", "Sexual, gendered slur used to harass.")
term("whore", ["wh0re", "hoe"], "en", "", "harassment", "high", "person", "Sexual, gendered slur used to harass.")
term("retard", ["retart", "r3tard", "tard"], "en", "", "harassment", "high", "person", "Ableist slur.")
term("kill yourself", ["kys", "kill urself", "kill yourselves"], "en", "", "harassment", "high", "", "Encourages self-harm. Never acceptable.")
term("nobody wants you", ["no one wants you"], "en", "", "harassment", "medium", "", "Targeted exclusion and belittling.")
term("kill you", ["kil you", "kill u"], "en", "", "threat", "high", "", "Threat of violence.")
term("beat you up", ["beat u up"], "en", "", "threat", "high", "", "Threat of violence.")
term("break your legs", ["break ur legs"], "en", "", "threat", "high", "", "Threat of violence.")
term("you are dead", ["ur dead", "you're dead", "youre dead"], "en", "", "threat", "high", "", "Threat of violence.")
term("watch your back", ["watch ur back"], "en", "", "threat", "high", "", "Intimidating threat.")
term("subhuman", ["sub human", "sub-human"], "en", "", "hate", "high", "", "Dehumanizing language about a group.")
term("vermin", ["vermins"], "en", "", "hate", "high", "", "Dehumanizing language about a group.", context=True)
term("go back to your country", ["go back to ur country"], "en", "", "hate", "high", "", "Xenophobic exclusion of a group.")

# Hindi (romanized)
term("chutiya", ["chutia", "chootiya", "chutiye", "ch*tiya", "chutya", "chu tiya"], "hi-Latn", "chutiya", "insult", "medium", "bewakoof insaan", "Vulgar insult (approx. 'idiot', vulgar).")
term("chutiyapa", ["chutiyapanti", "chutiyap"], "hi-Latn", "chutiyapa", "profanity", "low", "bakwas", "Vulgar word for nonsense.")
term("bhenchod", ["behenchod", "bhencho", "bhenchodd", "b3hench0d", "bhen chod"], "hi-Latn", "bhenchod", "profanity", "medium", "", "Strong sexual profanity.")
term("madarchod", ["maderchod", "mdrchod", "madarchodd", "maadarchod"], "hi-Latn", "madarchod", "profanity", "high", "", "Strong sexual profanity about someone's mother.")
term("gandu", ["gaandu", "g@ndu", "gandoo"], "hi-Latn", "gandu", "insult", "medium", "bekaar insaan", "Vulgar insult.")
term("harami", ["haraami", "haramkhor", "haramzada", "haraamzaade"], "hi-Latn", "harami", "insult", "medium", "dhokebaaz insaan", "Insult (approx. 'bastard').")
term("kamina", ["kameena", "kamine", "kamini", "kameeni"], "hi-Latn", "kamina", "insult", "medium", "bura insaan", "Insult (approx. 'scoundrel').")
term("kutte", ["kutta", "kuttey", "kutti"], "hi-Latn", "kutta", "insult", "medium", "insaan", "Means 'dog'; abusive only when aimed at a person.", context=True)
term("kuttiya", ["kutiya", "kuttiyaa"], "hi-Latn", "kuttiya", "harassment", "high", "insaan", "Gendered abusive slur.")
term("saala", ["sala", "saale", "saali", "saaley"], "hi-Latn", "saala", "profanity", "low", "", "Mild curse; also a family term ('brother-in-law'), so context matters.", context=True)
term("ullu ka pattha", ["ullu ke patthe", "ulloo ka pattha"], "hi-Latn", "ullu ka pattha", "insult", "medium", "nasamajh", "Insult (approx. 'fool').")
term("bewakoof", ["bevakoof", "bewakuf", "bevkoof"], "hi-Latn", "bewakoof", "insult", "low", "nasamajh", "Mild insult ('fool').", context=True)
term("gadha", ["gadhe", "gadhaa"], "hi-Latn", "gadha", "insult", "low", "nasamajh", "Means 'donkey'; insult when aimed at a person.", context=True)
term("randi", ["r@ndi", "randii", "randwa"], "hi-Latn", "randi", "harassment", "high", "", "Sexual, gendered slur used to harass.")
term("bhosdike", ["bhosdi ke", "bhosdiwale", "bhosadike", "bsdk"], "hi-Latn", "bhosdike", "insult", "high", "", "Strong vulgar insult.")
term("lavde", ["lode", "lauda", "lawde", "lund"], "hi-Latn", "lavde", "profanity", "medium", "", "Vulgar sexual word.")
term("teri maa ki", ["teri ma ki", "teri maa ka"], "hi-Latn", "teri maa ki", "insult", "high", "", "Abusive phrase about someone's mother.")
term("maar dunga", ["maar dalunga", "mar dunga", "maar doonga"], "hi-Latn", "maar dunga", "threat", "high", "", "Threat: 'I will beat/kill you'.")
term("jaan se maar", ["jaan se maar dunga", "jaan se maar denge"], "hi-Latn", "jaan se maar", "threat", "high", "", "Threat to kill.")
term("tujhe dekh lunga", ["dekh lunga tujhe", "tujhe dekh loonga"], "hi-Latn", "tujhe dekh lunga", "threat", "medium", "", "Intimidating threat ('I'll deal with you').")
term("haath pair tod dunga", ["haath pair tod denge", "taang tod dunga"], "hi-Latn", "haath pair tod dunga", "threat", "high", "", "Threat of violence.")
term("keede makode", ["keedey", "keede hain"], "hi-Latn", "keede makode", "hate", "high", "", "Dehumanizing comparison of a group to insects.")
term("desh se nikalo", ["desh se nikaal do", "inko bahar nikalo"], "hi-Latn", "desh se nikalo", "hate", "high", "", "Call to exclude a group.")

# Hindi (Devanagari)
term("चूतिया", ["चुतिया", "चूतिये"], "hi", "chutiya", "insult", "medium", "बेवकूफ इंसान", "Vulgar insult.")
term("बहनचोद", ["बहन चोद", "भेनचोद"], "hi", "bhenchod", "profanity", "medium", "", "Strong sexual profanity.")
term("मादरचोद", ["मादर चोद"], "hi", "madarchod", "profanity", "high", "", "Strong sexual profanity about someone's mother.")
term("गांडू", ["गाँडू"], "hi", "gandu", "insult", "medium", "बेकार इंसान", "Vulgar insult.")
term("हरामी", ["हरामज़ादा", "हरामखोर"], "hi", "harami", "insult", "medium", "धोखेबाज़ इंसान", "Insult.")
term("कमीना", ["कमीने", "कमीनी"], "hi", "kamina", "insult", "medium", "बुरा इंसान", "Insult.")
term("कुत्ते", ["कुत्ता", "कुत्ती"], "hi", "kutte", "insult", "medium", "इंसान", "Means 'dog'; abusive only when aimed at a person.", context=True)
term("साला", ["साले", "साली"], "hi", "saala", "profanity", "low", "", "Mild curse; also a family term.", context=True)
term("बेवकूफ", ["बेवकूफ़"], "hi", "bewakoof", "insult", "low", "नासमझ", "Mild insult.", context=True)
term("रंडी", [], "hi", "randi", "harassment", "high", "", "Sexual, gendered slur.")
term("भोसड़ीके", ["भोसडीके", "भोसड़ी के"], "hi", "bhosdike", "insult", "high", "", "Strong vulgar insult.")
term("मार डालूंगा", ["मार डालूँगा", "मार दूंगा"], "hi", "maar dalunga", "threat", "high", "", "Threat to kill.")
term("जान से मार", ["जान से मार दूंगा"], "hi", "jaan se maar", "threat", "high", "", "Threat to kill.")
term("देख लूंगा", ["तुझे देख लूंगा"], "hi", "dekh lunga", "threat", "medium", "", "Intimidating threat.")
term("कीड़े मकोड़े", ["कीड़े हैं"], "hi", "keede makode", "hate", "high", "", "Dehumanizing comparison of a group.")

# Gujarati (romanized)
term("gando", ["gaando", "gandi"], "gu-Latn", "gando", "insult", "low", "nasamajh", "Means 'crazy'; mild insult when aimed at a person.", context=True)
term("gadhedo", ["gadheda", "gadhedi", "gadhedaa"], "gu-Latn", "gadhedo", "insult", "low", "nasamajh", "Means 'donkey'; insult when aimed at a person.", context=True)
term("nalayak", ["naalayak", "nalaayak"], "gu-Latn", "nalayak", "insult", "medium", "bejavabdar", "Insult ('worthless').")
term("chutiyo", ["chutiya", "chutio"], "gu-Latn", "chutiyo", "insult", "medium", "nasamajh manas", "Vulgar insult.")
term("bhosdina", ["bhosadina", "bhosdinu", "bhosdi na"], "gu-Latn", "bhosdina", "insult", "high", "", "Strong vulgar insult.")
term("lodo", ["lodu", "lowdo", "lodaa"], "gu-Latn", "lodo", "profanity", "medium", "", "Vulgar sexual word.")
term("bhadvo", ["bhadva", "bhadvi", "bhadwa"], "gu-Latn", "bhadvo", "insult", "high", "", "Strong insult ('pimp').")
term("rand", ["randi", "raand"], "gu-Latn", "rand", "harassment", "high", "", "Sexual, gendered slur.")
term("tari maa ne", ["tari ma ne", "tari maa na"], "gu-Latn", "tari maa ne", "insult", "high", "", "Abusive phrase about someone's mother.")
term("buddhi vagar no", ["buddhi vagar na", "akkal vagar no"], "gu-Latn", "buddhi vagar no", "insult", "low", "thodo ochho samajhdar", "Mild insult ('brainless').")
term("tane mari nakhish", ["tane maari nakhish", "tane mari naakhish"], "gu-Latn", "tane mari nakhish", "threat", "high", "", "Threat to kill.")
term("taru mathu fodi nakhish", ["taru maathu fodi nakhish", "mathu fodi nakhish"], "gu-Latn", "taru mathu fodi nakhish", "threat", "high", "", "Threat of violence.")
term("tane joi laish", ["joi laish tane", "tane jovi laish"], "gu-Latn", "tane joi laish", "threat", "medium", "", "Intimidating threat ('I'll deal with you').")
term("kida makoda", ["kida jeva"], "gu-Latn", "kida makoda", "hate", "high", "", "Dehumanizing comparison of a group.")

# Gujarati (script)
term("ગાંડો", ["ગાંડી"], "gu", "gando", "insult", "low", "નાસમજ", "Means 'crazy'; mild insult when aimed at a person.", context=True)
term("ગધેડો", ["ગધેડા", "ગધેડી"], "gu", "gadhedo", "insult", "low", "નાસમજ", "Means 'donkey'; insult when aimed at a person.", context=True)
term("નાલાયક", [], "gu", "nalayak", "insult", "medium", "બેજવાબદાર", "Insult ('worthless').")
term("ચુતિયો", ["ચુતિયા"], "gu", "chutiyo", "insult", "medium", "નાસમજ માણસ", "Vulgar insult.")
term("ભોસડીના", [], "gu", "bhosdina", "insult", "high", "", "Strong vulgar insult.")
term("લોડો", ["લોડા"], "gu", "lodo", "profanity", "medium", "", "Vulgar sexual word.")
term("ભડવો", ["ભડવા"], "gu", "bhadvo", "insult", "high", "", "Strong insult.")
term("રાંડ", [], "gu", "rand", "harassment", "high", "", "Sexual, gendered slur.")
term("તને મારી નાખીશ", ["મારી નાખીશ"], "gu", "tane mari nakhish", "threat", "high", "", "Threat to kill.")
term("તારું માથું ફોડી નાખીશ", ["માથું ફોડી નાખીશ"], "gu", "taru mathu fodi nakhish", "threat", "high", "", "Threat of violence.")
term("કીડા મકોડા", [], "gu", "kida makoda", "hate", "high", "", "Dehumanizing comparison of a group.")

# Words that LOOK abusive but are clean (hard negatives), listed on sheet 1 with is_inappropriate=False
HARD_NEGATIVE_WORDS = [
    ("class", "en", "Contains 'ass' as a substring; ordinary word."),
    ("assistant", "en", "Contains 'ass' as a substring; ordinary word."),
    ("scrap", "en", "Contains 'crap' as a substring; ordinary word."),
    ("Gandhinagar", "en", "City name containing 'gand'."),
    ("chhod do", "hi-Latn", "Means 'leave it'; not the vulgar 'chod'."),
    ("saal", "hi-Latn", "Means 'year'; not the curse 'saala'."),
    ("ganda", "hi-Latn", "Means 'dirty' (e.g. a dirty room); not an insult in itself."),
    ("kutro", "gu-Latn", "Means 'dog' in Gujarati; ordinary word."),
    ("killer app", "en", "Idiom meaning an excellent application."),
    ("bakwas", "hi-Latn", "Means 'nonsense'; ordinary criticism, not vulgar."),
]

# ---------------------------------------------------------------------------------------------
# Obfuscation helpers (applied to the abusive word only)
# ---------------------------------------------------------------------------------------------
LEET = {"a": "4", "e": "3", "i": "1", "o": "0", "s": "$", "t": "7"}


def leet(word):
    out = [LEET.get(c, c) if c in LEET and rng.random() < 0.6 else c for c in word]
    return "".join(out) if "".join(out) != word else word.replace("i", "1", 1).replace("o", "0", 1)


def spaced(word):
    sep = rng.choice([" ", ".", "-"])
    return sep.join(word.replace(" ", ""))


def repeated(word):
    idx = [i for i, c in enumerate(word) if c.isalpha()]
    i = rng.choice(idx) if idx else 0
    return word[: i + 1] + word[i] * rng.randint(2, 4) + word[i + 1:]


def starred(word):
    letters = [i for i, c in enumerate(word) if c.isalpha()]
    if len(letters) < 4:
        return word
    i = rng.choice(letters[1:-1])
    return word[:i] + "*" + word[i + 1:]


OBFUSCATORS = {"leet": leet, "spaced": spaced, "repeated": repeated, "star": starred}


def is_latin(text):
    return all(ord(c) < 0x250 for c in text)


# ---------------------------------------------------------------------------------------------
# Sentence templates: (id, category, severity, abusive template, rewrite template)
# {w} = abusive word slot, {r} = its replacement in the rewrite, {t} = topic filler.
# ---------------------------------------------------------------------------------------------
TOPICS = {
    "en": ["the meeting", "the project", "your code", "the report", "this group chat", "the match", "the delivery", "the update", "the assignment", "the presentation", "the plan", "the trip"],
    "hi-Latn": ["meeting", "project", "kaam", "report", "group", "match", "order", "assignment", "plan", "trip", "exam", "deadline"],
    "gu-Latn": ["meeting", "project", "kaam", "report", "group", "match", "order", "assignment", "plan", "pravas", "exam", "deadline"],
    "hi": ["मीटिंग", "प्रोजेक्ट", "काम", "रिपोर्ट", "ग्रुप", "मैच", "ऑर्डर", "परीक्षा", "प्लान", "यात्रा"],
    "gu": ["મીટિંગ", "પ્રોજેક્ટ", "કામ", "રિપોર્ટ", "ગ્રુપ", "મેચ", "ઓર્ડર", "પરીક્ષા", "પ્લાન", "પ્રવાસ"],
}
TOPICS["hinglish"] = TOPICS["en"] + TOPICS["hi-Latn"]

INSULT_TEMPLATES = {
    "en": [
        ("insult-you-are", "You are such a {w}, you ruined {t}.", "You really let me down, you ruined {t}."),
        ("insult-only", "Only a {w} would mess up {t} like this.", "Only someone careless would mess up {t} like this."),
        ("insult-stop", "Stop acting like a {w} and fix {t}.", "Please take this seriously and fix {t}."),
        ("insult-shut", "Shut up, you {w}. Nobody asked about {t}.", "Please stop. Nobody asked about {t}."),
        ("insult-friend", "My manager is a total {w}, he blamed me for {t}.", "My manager was unfair, he blamed me for {t}."),
        ("insult-reply", "Reply to my message, you {w}, I've been waiting about {t} all day.", "Please reply to my message, I've been waiting about {t} all day."),
        ("insult-group", "Everyone in this group is a {w} for supporting {t}.", "I strongly disagree with everyone in this group supporting {t}."),
    ],
    "hi-Latn": [
        ("insult-tu", "Tu ekdum {w} hai, {t} kharab kar diya.", "Tune {t} kharab kar diya, mujhe bahut bura laga."),
        ("insult-abe", "Abe {w}, {t} pe dhyan de.", "Please {t} pe dhyan do."),
        ("insult-boss", "Mera boss pura {w} hai, {t} ka blame mujh pe daal diya.", "Mera boss unfair tha, {t} ka blame mujh pe daal diya."),
        ("insult-kaun", "Kaun {w} ne {t} aise banaya?", "{t} kisne aise banaya? Isme sudhaar chahiye."),
        ("insult-chup", "Chup kar {w}, {t} ke baare mein kuch nahi pata tujhe.", "Ruko, shayad {t} ke baare mein tumhe poori jaankari nahi hai."),
    ],
    "gu-Latn": [
        ("insult-tu", "Tu sav {w} che, {t} bagadi nakhyu.", "Te {t} bagadi nakhyu, mane bahu kharab lagyu."),
        ("insult-ae", "Ae {w}, {t} par dhyan aap.", "Please {t} par dhyan aapo."),
        ("insult-boss", "Maro boss pakko {w} che, {t} no blame mara par nakhyo.", "Maro boss anyay kare che, {t} no blame mara par nakhyo."),
        ("insult-kon", "Kon {w} e {t} aavu banavyu?", "{t} kone aavu banavyu? Ema sudharo joie."),
        ("insult-chup", "Chup re {w}, tane {t} vishe kai khabar nathi.", "Mane lage che ke tamne {t} vishe puri mahiti nathi."),
    ],
    "hi": [
        ("insult-tu", "तू एकदम {w} है, {t} खराब कर दिया।", "तुमने {t} खराब कर दिया, मुझे बहुत बुरा लगा।"),
        ("insult-boss", "मेरा बॉस पूरा {w} है, {t} का दोष मुझ पर डाल दिया।", "मेरे बॉस ने गलत किया, {t} का दोष मुझ पर डाल दिया।"),
        ("insult-chup", "चुप कर {w}, तुझे {t} के बारे में कुछ नहीं पता।", "शायद तुम्हें {t} के बारे में पूरी जानकारी नहीं है।"),
        ("insult-kaun", "किस {w} ने {t} ऐसे बनाया?", "{t} किसने ऐसे बनाया? इसमें सुधार चाहिए।"),
    ],
    "gu": [
        ("insult-tu", "તું સાવ {w} છે, {t} બગાડી નાખ્યું.", "તેં {t} બગાડી નાખ્યું, મને બહુ ખરાબ લાગ્યું."),
        ("insult-boss", "મારો બોસ પાક્કો {w} છે, {t} નો દોષ મારા પર નાખ્યો.", "મારા બોસે અન્યાય કર્યો, {t} નો દોષ મારા પર નાખ્યો."),
        ("insult-chup", "ચૂપ રે {w}, તને {t} વિશે કંઈ ખબર નથી.", "મને લાગે છે કે તમને {t} વિશે પૂરી માહિતી નથી."),
        ("insult-kon", "કયા {w} એ {t} આવું બનાવ્યું?", "{t} કોણે આવું બનાવ્યું? એમાં સુધારો જોઈએ."),
    ],
    "hinglish": [
        ("insult-bro", "Bro tu literally {w} hai, {t} ka pura scene kharab kar diya.", "Bro tune {t} ka pura scene kharab kar diya, not cool."),
        ("insult-seriously", "Seriously yaar, kitna bada {w} hai tu, {t} bhi time pe nahi hua.", "Seriously yaar, {t} bhi time pe nahi hua, bahut disappointing hai."),
        ("insult-team", "Iss team mein sab {w} hain, {t} ka koi plan hi nahi.", "Iss team mein {t} ka koi plan hi nahi, it's frustrating."),
    ],
}

PROFANITY_TEMPLATES = {
    "en": [
        ("prof-what", "What the {w} happened to {t}?", "What on earth happened to {t}?"),
        ("prof-this", "This is {w} ridiculous, {t} is late again.", "This is really ridiculous, {t} is late again."),
        ("prof-tired", "I'm so {w} tired of {t}.", "I'm so tired of {t}."),
        ("prof-oh", "Oh {w}, I forgot about {t}.", "Oh no, I forgot about {t}."),
        ("prof-load", "{t} was a load of {w} honestly.", "{t} was really disappointing honestly."),
    ],
    "hi-Latn": [
        ("prof-yaar", "{w} yaar, {t} phir se late ho gaya.", "Yaar, {t} phir se late ho gaya."),
        ("prof-kya", "Kya {w} hai ye {t}.", "Ye {t} bilkul theek nahi hai."),
    ],
    "gu-Latn": [
        ("prof-yaar", "{w} yaar, {t} pachhu late thai gayu.", "Yaar, {t} pachhu late thai gayu."),
        ("prof-shu", "Shu {w} che aa {t}.", "Aa {t} barabar nathi."),
    ],
    "hi": [("prof-yaar", "{w} यार, {t} फिर से लेट हो गया।", "यार, {t} फिर से लेट हो गया।")],
    "gu": [("prof-yaar", "{w} યાર, {t} પાછું લેટ થઈ ગયું.", "યાર, {t} પાછું લેટ થઈ ગયું.")],
    "hinglish": [("prof-bro", "{w} bro, {t} toh total flop tha.", "Bro, {t} toh total flop tha.")],
}

# Fixed-phrase templates (threats, harassment, hate): the abusive phrase is part of the template
FIXED = [
    # (id, lang, category, severity, text, rewrite)
    ("threat-en-1", "en", "threat", "high", "If you post that again I will kill you.", "Please don't post that again, it really upsets me."),
    ("threat-en-2", "en", "threat", "high", "Say one more word and I'll beat you up after class.", "Please stop, I don't want to argue with you anymore."),
    ("threat-en-3", "en", "threat", "high", "I know where you live, watch your back.", "I'm very angry about what you did."),
    ("threat-en-4", "en", "threat", "high", "Keep talking and I'll break your legs.", "Please stop talking to me like that."),
    ("threat-en-5", "en", "threat", "high", "You are dead if you show up at the match tomorrow.", "I'd rather you didn't come to the match tomorrow."),
    ("threat-en-6", "en", "threat", "high", "I'm going to find you and make you regret this.", "I'm very upset and I want to talk about this."),
    ("threat-en-7", "en", "threat", "high", "Someone should hurt you so you finally learn.", "I hope you understand why this was wrong."),
    ("threat-hi-latn-1", "hi-Latn", "threat", "high", "Agar dobara aisa likha toh maar dunga tujhe.", "Please dobara aisa mat likhna, mujhe bahut bura laga."),
    ("threat-hi-latn-2", "hi-Latn", "threat", "high", "Kal college ke bahar mil, jaan se maar dunga.", "Kal college ke bahar milkar baat karte hain."),
    ("threat-hi-latn-3", "hi-Latn", "threat", "medium", "Tujhe dekh lunga, bas ruk ja.", "Is baare mein baad mein baat karte hain."),
    ("threat-hi-latn-4", "hi-Latn", "threat", "high", "Ek aur comment kiya toh haath pair tod dunga.", "Please aur comment mat karo, ye theek nahi hai."),
    ("threat-hi-1", "hi", "threat", "high", "अगर दोबारा ऐसा लिखा तो मार डालूंगा।", "कृपया दोबारा ऐसा मत लिखना, मुझे बुरा लगा।"),
    ("threat-hi-2", "hi", "threat", "high", "कल मिल, जान से मार दूंगा।", "कल मिलकर बात करते हैं।"),
    ("threat-hi-3", "hi", "threat", "medium", "तुझे देख लूंगा, रुक जा।", "इस बारे में बाद में बात करते हैं।"),
    ("threat-gu-latn-1", "gu-Latn", "threat", "high", "Biji vaar aavu lakhis toh tane mari nakhish.", "Please biji vaar aavu na lakhta, mane kharab lagyu."),
    ("threat-gu-latn-2", "gu-Latn", "threat", "high", "Kale bahar mal, taru mathu fodi nakhish.", "Kale bahar maline vaat kariye."),
    ("threat-gu-latn-3", "gu-Latn", "threat", "medium", "Tane joi laish, thobh tu.", "Aa vishe pachhi vaat kariye."),
    ("threat-gu-1", "gu", "threat", "high", "બીજી વાર આવું લખીશ તો તને મારી નાખીશ.", "મહેરબાની કરીને બીજી વાર આવું ન લખતા."),
    ("threat-gu-2", "gu", "threat", "high", "કાલે મળ, તારું માથું ફોડી નાખીશ.", "કાલે મળીને વાત કરીએ."),
    ("threat-hinglish-1", "hinglish", "threat", "high", "Bro next time aisa kiya toh I swear maar dunga.", "Bro next time aisa mat karna, seriously not okay."),
    ("harass-en-1", "en", "harassment", "high", "Nobody would miss you, just go kill yourself.", "I'm really angry at you right now."),
    ("harass-en-2", "en", "harassment", "medium", "Everyone in class hates you, nobody wants you here.", "I don't think this group is working well together."),
    ("harass-en-3", "en", "harassment", "high", "Look at her, such a slut, posting pics all day.", "She posts a lot of pictures."),
    ("harass-en-4", "en", "harassment", "high", "Stop being a retard and read the instructions.", "Please read the instructions carefully."),
    ("harass-en-5", "en", "harassment", "medium", "I'll keep messaging you every hour until you reply, you can't hide.", "Please reply when you get a chance."),
    ("harass-en-6", "en", "harassment", "high", "Send me your pics or I'll share your number everywhere.", "Please don't contact me like this."),
    ("harass-hi-latn-1", "hi-Latn", "harassment", "high", "Ye ladki toh randi hai, har jagah photo daalti hai.", "Ye ladki bahut photos post karti hai."),
    ("harass-hi-latn-2", "hi-Latn", "harassment", "medium", "Koi tujhe pasand nahi karta, group chhod de.", "Mujhe lagta hai group mein sab ki raay alag hai."),
    ("harass-hi-1", "hi", "harassment", "high", "ये लड़की तो रंडी है, हर जगह फोटो डालती है।", "ये लड़की बहुत फोटो पोस्ट करती है।"),
    ("harass-gu-latn-1", "gu-Latn", "harassment", "high", "Aa chhokri toh rand che, aakho divas photo muke che.", "Aa chhokri bahu photos muke che."),
    ("harass-gu-latn-2", "gu-Latn", "harassment", "medium", "Tane koi pasand nathi kartu, group chhodi de.", "Mane lage che group ma badha ni raay alag che."),
    ("harass-gu-1", "gu", "harassment", "high", "આ છોકરી તો રાંડ છે, આખો દિવસ ફોટા મૂકે છે.", "આ છોકરી બહુ ફોટા મૂકે છે."),
    ("hate-en-1", "en", "hate", "high", "People from that community are vermin and should be thrown out.", "I disagree with some policies about that community."),
    ("hate-en-2", "en", "hate", "high", "Those outsiders are subhuman, they don't deserve to live here.", "I have concerns about how the city is managing growth."),
    ("hate-en-3", "en", "hate", "high", "Go back to your country, nobody wants your kind here.", "I disagree with you on this issue."),
    ("hate-en-4", "en", "hate", "high", "That whole religion is a disease that should be wiped out.", "I strongly disagree with some beliefs I've heard."),
    ("hate-hi-latn-1", "hi-Latn", "hate", "high", "Is community ke log keede makode hain, desh se nikalo inko.", "Mujhe kuch neetiyon se asehmati hai."),
    ("hate-hi-latn-2", "hi-Latn", "hate", "high", "Ye bahar wale log gande hain, inko yahan rehne ka haq nahi.", "Mujhe sheher ki vyavastha ko lekar chinta hai."),
    ("hate-hi-1", "hi", "hate", "high", "उस समुदाय के लोग कीड़े मकोड़े हैं, इन्हें देश से निकालो।", "मुझे कुछ नीतियों से असहमति है।"),
    ("hate-gu-latn-1", "gu-Latn", "hate", "high", "Ae community na loko kida makoda che, emne bahar kadho.", "Mane amuk niyamo sathe asahmati che."),
    ("hate-gu-1", "gu", "hate", "high", "એ સમાજના લોકો કીડા મકોડા છે, એમને બહાર કાઢો.", "મને અમુક નિયમો સાથે અસહમતિ છે."),
]

# ---------------------------------------------------------------------------------------------
# Clean content (criticism, disagreement, jokes, everyday chat, hard negatives)
# ---------------------------------------------------------------------------------------------
CLEAN = {
    "en": [
        ("clean-crit-1", "criticism", "Honestly {t} was disappointing, I expected much better."),
        ("clean-crit-2", "criticism", "I strongly disagree with how {t} was handled."),
        ("clean-crit-3", "criticism", "This policy is stupid and badly thought out, in my opinion."),
        ("clean-crit-4", "criticism", "The new update is terrible, the app crashes every time I open it."),
        ("clean-crit-5", "criticism", "That was the worst customer service I've ever had."),
        ("clean-crit-6", "criticism", "Your argument about {t} doesn't make sense to me, can you explain it again?"),
        ("clean-crit-7", "criticism", "I hate waiting in long queues, it ruins my whole day."),
        ("clean-disagree-1", "disagreement", "I see your point, but I think you're wrong about {t}."),
        ("clean-disagree-2", "disagreement", "We clearly have different opinions on {t}, and that's okay."),
        ("clean-joke-1", "joke", "My cat judged me so hard today, I think she's my manager now."),
        ("clean-joke-2", "joke", "I'm not lazy, I'm just in energy saving mode."),
        ("clean-idiom-1", "idiom", "This traffic is killing me, I'll be late for {t}."),
        ("clean-idiom-2", "idiom", "She absolutely killed it at {t} yesterday!"),
        ("clean-idiom-3", "idiom", "I'm dying to know what happens next."),
        ("clean-idiom-4", "idiom", "That killer app saved me hours on {t}."),
        ("clean-chat-1", "everyday", "Can anyone share notes for {t}? I missed it."),
        ("clean-chat-2", "everyday", "Happy birthday! Hope you have an amazing year ahead."),
        ("clean-chat-3", "everyday", "Thanks everyone for the help with {t}, really appreciate it."),
        ("clean-chat-4", "everyday", "The class assistant explained the scrap metal recycling process."),
        ("clean-chat-5", "everyday", "Just reached Gandhinagar, the weather is lovely today."),
        ("clean-sad-1", "negative-emotion", "I feel really frustrated and tired after {t}."),
        ("clean-sad-2", "negative-emotion", "I'm upset that nobody told me about {t} earlier."),
    ],
    "hi-Latn": [
        ("clean-crit-1", "criticism", "Sach bolun toh {t} bahut bekaar tha, umeed zyada thi."),
        ("clean-crit-2", "criticism", "Ye movie bakwas thi, paise barbaad ho gaye."),
        ("clean-crit-3", "criticism", "Mujhe {t} ka tareeka bilkul pasand nahi aaya."),
        ("clean-disagree-1", "disagreement", "Main tumse sehmat nahi hoon, {t} ke baare mein mera alag vichaar hai."),
        ("clean-chat-1", "everyday", "Chhod do yaar, {t} kal dekhenge."),
        ("clean-chat-2", "everyday", "Mera kutta bahut pyara hai, roz subah ghumne jaata hai."),
        ("clean-chat-3", "everyday", "Is saal {t} bahut achha raha."),
        ("clean-chat-4", "everyday", "Kamra bahut ganda tha, isliye humne hotel badal diya."),
        ("clean-joke-1", "joke", "Monday ko dekhte hi meri neend bhaag jaati hai."),
        ("clean-sad-1", "negative-emotion", "Aaj bahut thak gaya hoon, {t} ne pareshaan kar diya."),
    ],
    "gu-Latn": [
        ("clean-crit-1", "criticism", "Saachu kahu toh {t} bahu bekar hatu, apeksha vadhare hati."),
        ("clean-crit-2", "criticism", "Aa film bilkul nakami hati, paisa bagadya."),
        ("clean-crit-3", "criticism", "Mane {t} ni rit bilkul na gami."),
        ("clean-disagree-1", "disagreement", "Hu tamari vaat sathe sahmat nathi, {t} vishe maru alag maanvu che."),
        ("clean-disagree-2", "disagreement", "Tame khota cho evu mane lage che, pan aapne vaat kari shakiye."),
        ("clean-chat-1", "everyday", "Maro kutro bahu cute che, roj savare farva jay che."),
        ("clean-chat-2", "everyday", "Kale {t} mate badha time par aavjo."),
        ("clean-chat-3", "everyday", "Gandhinagar ma aaje varsad padyo, mosam saras che."),
        ("clean-idiom-1", "idiom", "Aaje traffic e to jaan kadhi nakhi, {t} mate late thayo."),
        ("clean-sad-1", "negative-emotion", "Aaje hu bahu thaki gayo chu, {t} e pareshan kari didho."),
    ],
    "hi": [
        ("clean-crit-1", "criticism", "सच कहूँ तो {t} बहुत निराशाजनक था।"),
        ("clean-crit-2", "criticism", "मुझे {t} का तरीका बिल्कुल पसंद नहीं आया।"),
        ("clean-disagree-1", "disagreement", "मैं आपसे सहमत नहीं हूँ, {t} के बारे में मेरी राय अलग है।"),
        ("clean-chat-1", "everyday", "मेरा कुत्ता बहुत प्यारा है, रोज़ सुबह घूमने जाता है।"),
        ("clean-chat-2", "everyday", "कल {t} के लिए सब समय पर आना।"),
        ("clean-chat-3", "everyday", "इस साल {t} बहुत अच्छा रहा।"),
        ("clean-sad-1", "negative-emotion", "आज बहुत थक गया हूँ, {t} ने परेशान कर दिया।"),
    ],
    "gu": [
        ("clean-crit-1", "criticism", "સાચું કહું તો {t} બહુ નિરાશાજનક હતું."),
        ("clean-crit-2", "criticism", "મને {t} ની રીત બિલકુલ ન ગમી."),
        ("clean-disagree-1", "disagreement", "હું તમારી વાત સાથે સહમત નથી, {t} વિશે મારું અલગ માનવું છે."),
        ("clean-chat-1", "everyday", "મારો કૂતરો બહુ પ્યારો છે, રોજ સવારે ફરવા જાય છે."),
        ("clean-chat-2", "everyday", "કાલે {t} માટે બધા સમયસર આવજો."),
        ("clean-chat-3", "everyday", "ગાંધીનગરમાં આજે વરસાદ પડ્યો, મોસમ સરસ છે."),
        ("clean-sad-1", "negative-emotion", "આજે હું બહુ થાકી ગયો છું, {t} એ હેરાન કરી દીધો."),
    ],
    "hinglish": [
        ("clean-crit-1", "criticism", "Bro {t} was such a letdown, ekdum boring tha."),
        ("clean-crit-2", "criticism", "Honestly yaar, ye update bilkul useless hai, app baar baar crash ho rahi hai."),
        ("clean-disagree-1", "disagreement", "I get your point bro, but {t} ke baare mein I totally disagree."),
        ("clean-joke-1", "joke", "Exam se pehle wali raat main full topper mode mein hota hoon, exam mein full zero."),
        ("clean-chat-1", "everyday", "Guys {t} ka plan kya hai? Let me know jaldi."),
        ("clean-chat-2", "everyday", "Chhod na yaar, {t} next week kar lenge, chill."),
        ("clean-idiom-1", "idiom", "Ye garmi toh jaan le legi, {t} ke liye bahar jaana padega."),
    ],
}

# Mixed-language sheet: explicit mixed examples (clean and abusive), plus generated paragraphs
MIXED = [
    # (id, lang, category, severity, text, rewrite or None)
    ("mix-en-gu-1", "en-gu", "insult", "medium", "This guy is a total gadhedo, never replies on time and blames others.", "This guy never replies on time and blames others, it's frustrating."),
    ("mix-en-gu-2", "en-gu", "clean", "none", "Thank you so much, tame project ma bahu help kari, really appreciate it!", None),
    ("mix-en-gu-3", "en-gu", "insult", "high", "Seriously bhosdina, how many times do I have to explain the same thing?", "Seriously, how many times do I have to explain the same thing?"),
    ("mix-en-gu-4", "en-gu", "clean", "none", "Aaje meeting was so long, maru mathu dukhe che now.", None),
    ("mix-en-gu-5", "en-gu", "threat", "high", "Listen carefully, biji vaar aavu karis toh tane mari nakhish.", "Listen carefully, please don't do this again."),
    ("mix-en-gu-6", "en-gu", "clean", "none", "Honestly the food was bekar, but the view was amazing.", None),
    ("mix-en-hi-gu-1", "en-hi-gu", "insult", "medium", "Bro tu chutiya hai kya? Aaje pan late aavyo and meeting miss kari.", "Bro, aaje pan late aavyo and meeting miss kari, please be on time."),
    ("mix-en-hi-gu-2", "en-hi-gu", "clean", "none", "Yaar kal ka plan fix che? Let's meet at 6, mujhe late nahi hona.", None),
    ("mix-en-hi-gu-3", "en-hi-gu", "profanity", "low", "Bhenchod yaar, aaje pan traffic ma atki gayo, so annoying.", "Yaar, aaje pan traffic ma atki gayo, so annoying."),
    ("mix-en-hi-gu-4", "en-hi-gu", "clean", "none", "Movie bakwas hati but popcorn was great, overall timepass.", None),
    ("mix-en-hi-script-1", "en-hi-script", "insult", "medium", "Dude तू सच में कमीना है, you took my notes and never returned them.", "Dude, you took my notes and never returned them, that's not fair."),
    ("mix-en-hi-script-2", "en-hi-script", "clean", "none", "Today was amazing, मैंने पहली बार marathon पूरी की!", None),
    ("mix-en-gu-script-1", "en-gu-script", "insult", "medium", "This report is late again, તું સાવ નાલાયક છે.", "This report is late again, please take responsibility."),
    ("mix-en-gu-script-2", "en-gu-script", "clean", "none", "Weekend plan: ગાંધીનગર trip and then dinner with family.", None),
    ("mix-hinglish-1", "hinglish", "insult", "medium", "Abe gandu, group mein spam mat kar, it's so irritating.", "Please group mein spam mat karo, it's so irritating."),
    ("mix-hinglish-2", "hinglish", "clean", "none", "Kal ka match was insane, last over mein full drama!", None),
    ("mix-hinglish-3", "hinglish", "harassment", "medium", "Sab tujhse pareshan hain, nobody wants you in this group.", "I think the group is not getting along well right now."),
]

# Free-form everyday posts (not templated), each its own group: what most real posts look like.
# They keep the classifier from treating ordinary sentences as suspicious.
CLEAN_GENERIC = {
    "en": [
        "Had a great time at the conference today, learned a lot!",
        "Finally finished my first marathon, legs are sore but I'm so happy.",
        "Does anyone know a good place for coffee near the station?",
        "Just adopted a puppy and she already owns the sofa.",
        "Grateful for my team, we shipped the release on time.",
        "Rainy Sunday, a good book and hot chai. Perfect.",
        "My grandmother turned 90 today, the whole family came together.",
        "Started learning the guitar, my fingers hurt but it's fun.",
        "The sunset at the beach yesterday was unreal.",
        "Looking for recommendations for a beginner camera.",
        "Congratulations to everyone who graduated this week!",
        "I cooked biryani for the first time and it actually worked.",
        "Our robotics club won second place at the state competition.",
        "Reminder: the library closes early on Friday.",
        "Trying to drink more water and sleep earlier this month.",
        "What a match last night, both teams played brilliantly.",
        "New blog post is up: five lessons from my first internship.",
        "Volunteered at the animal shelter this weekend, highly recommend it.",
        "Can't believe it's already the end of the semester.",
        "Huge thanks to the nurses at the city hospital for their care.",
        "The new metro line saves me forty minutes every day.",
        "Anyone else watching the cricket final tonight?",
        "Weekend trip to the mountains, no network and zero regrets.",
        "Tip: back up your phone photos before updating the software.",
        "We planted twenty trees in the colony park this morning.",
        "Have a lovely weekend everyone!",
        "Good morning everyone, have a great day!",
        "Enjoy your weekend, friends!",
        "See you all at the party tonight.",
        "Thank you all for the birthday wishes, feeling loved.",
        "Congrats on the new job, you deserve it!",
        "Wishing everyone a happy and safe festival season.",
        "Best of luck to all the students writing exams tomorrow.",
        "Our neighbourhood clean-up drive collected forty bags of waste.",
        "Movie night with the family, popcorn ready.",
        "The new cafe downtown makes the best cold coffee.",
        "Proud of my little brother for scoring a century in his first match.",
        "Anyone up for a morning cycling group this weekend?",
        "Just finished reading a brilliant book on space exploration.",
        "Throwback to our college trip, miss these people.",
        "Learning to code at forty, it is never too late.",
        "Fresh mangoes from the farm, summer is here.",
        "The kids built a sandcastle taller than them today.",
        "Excited to announce that I'm starting my master's this fall.",
        "Shoutout to the bus driver who waited for me this morning.",
        "Weekend plans: sleep, eat, repeat.",
        "Happy anniversary to the best parents in the world.",
        "Our startup just crossed one thousand users, thank you all!",
        "It's been raining all day, perfect weather for soup.",
        "Finally cleaned my desk, I can see the wood again.",
    ],
    "hinglish": [
        "Aaj conference mein bahut kuch seekha, great experience!",
        "Finally weekend aa gaya, Netflix and chill time.",
        "Koi achha cafe suggest karo near the station?",
        "Mummy ne aaj rajma chawal banaye, best lunch ever.",
        "Exam khatam, ab bas sona hai do din.",
        "Office mein aaj team lunch tha, maza aa gaya.",
        "Naya phone liya, camera quality is amazing.",
        "Bhai ki shaadi ki shopping chal rahi hai, bahut busy week.",
        "Happy weekend everyone, enjoy karo!",
        "Sab log kal party mein aa rahe ho na? Can't wait.",
        "Thank you sabko birthday wishes ke liye, feeling special.",
        "Finally gym join kar liya, wish me luck guys.",
        "Diwali ki shopping done, ab bas mithai ka wait.",
        "Aaj ka sunset was just wow, photo bhi share karunga.",
        "Congratulations bhai, new job ke liye best of luck!",
    ],
    "hi-Latn": [
        "Aaj subah park mein ghoomne gaya, mausam bahut suhana tha.",
        "Dadi ji ka janamdin tha, poora parivaar ikattha hua.",
        "Naya gaana seekh raha hoon, thoda mushkil hai par maza aa raha hai.",
        "Kal se nayi naukri shuru ho rahi hai, thoda nervous hoon.",
        "Barish mein garam chai aur pakode, aur kya chahiye.",
    ],
    "gu-Latn": [
        "Aaje savare garden ma farva gayo, mosam bahu saras hatu.",
        "Ba no janmadin hato, aakho parivar bhego thayo.",
        "Kale thi navi job sharu thay che, thodu tension che.",
        "Varsad ma garam chaa ane bhajiya, bas majja.",
        "Navratri ni taiyari chalu thai gai, garba practice roj.",
    ],
    "en-gu": [
        "Had an amazing weekend, family sathe dinner and long drive.",
        "Navratri vibes already, garba practice every evening!",
        "Finally exam patyu, now time to relax and travel.",
    ],
    "hi": [
        "आज सुबह पार्क में घूमने गया, मौसम बहुत सुहाना था।",
        "दादी जी का जन्मदिन था, पूरा परिवार इकट्ठा हुआ।",
        "कल से नई नौकरी शुरू हो रही है, थोड़ा घबराहट है।",
        "बारिश में गरम चाय और पकोड़े, और क्या चाहिए।",
        "आज पहली बार बिरयानी बनाई और अच्छी बनी।",
    ],
    "gu": [
        "આજે સવારે બગીચામાં ફરવા ગયો, મોસમ બહુ સરસ હતું.",
        "બાનો જન્મદિવસ હતો, આખો પરિવાર ભેગો થયો.",
        "કાલથી નવી નોકરી શરૂ થાય છે, થોડું ટેન્શન છે.",
        "વરસાદમાં ગરમ ચા અને ભજીયા, બસ મજા.",
        "નવરાત્રિની તૈયારી ચાલુ થઈ ગઈ, રોજ ગરબાની પ્રેક્ટિસ.",
    ],
}

# Slot-based threat / harassment / hate templates for more variety: (id, lang, category, severity,
# template, rewrite, slots) where slots maps placeholder -> options
GENERIC_GROUPS = {
    "en": ["people from that community", "those outsiders", "people of that religion", "migrants from that region", "people from that caste"],
    "hi-Latn": ["us community ke log", "ye bahar wale", "us dharm ke log", "us ilaake ke log"],
    "gu-Latn": ["ae samaj na loko", "aa bahar na loko", "ae dharm na loko", "ae vistar na loko"],
    "hi": ["उस समुदाय के लोग", "ये बाहर वाले", "उस धर्म के लोग"],
    "gu": ["એ સમાજના લોકો", "આ બહારના લોકો", "એ ધર્મના લોકો"],
}
SLOTTED = [
    ("threat-en-slot", "en", "threat", "high", "{c} I will {a}.", "{c} I will be very upset.", {
        "c": ["If you post that again,", "Show up tomorrow and", "Keep ignoring me and", "One more comment and", "Touch my bike again and"],
        "a": ["kill you", "beat you up", "break your legs", "hurt you badly", "smash your face in"]}),
    ("threat-hi-latn-slot", "hi-Latn", "threat", "high", "{c} {a}.", "{c} mujhe bahut bura lagega.", {
        "c": ["Agar dobara aisa kiya toh", "Kal mila toh", "Ek aur comment kiya toh", "Meri bike ko haath lagaya toh"],
        "a": ["maar dunga tujhe", "jaan se maar dunga", "haath pair tod dunga", "tera muh tod dunga"]}),
    ("threat-gu-latn-slot", "gu-Latn", "threat", "high", "{c} {a}.", "{c} mane bahu kharab lagse.", {
        "c": ["Jo biji vaar aavu karis toh", "Kale malis toh", "Ek pan comment karis toh", "Mari bike ne adkis toh"],
        "a": ["tane mari nakhish", "taru mathu fodi nakhish", "tara haath pag todi nakhish", "tane joi laish"]}),
    ("threat-hi-slot", "hi", "threat", "high", "{c} {a}।", "{c} मुझे बहुत बुरा लगेगा।", {
        "c": ["अगर दोबारा ऐसा किया तो", "कल मिला तो", "एक और कमेंट किया तो"],
        "a": ["मार डालूंगा", "जान से मार दूंगा", "हाथ पैर तोड़ दूंगा"]}),
    ("threat-gu-slot", "gu", "threat", "high", "{c} {a}.", "{c} મને બહુ ખરાબ લાગશે.", {
        "c": ["જો બીજી વાર આવું કરીશ તો", "કાલે મળીશ તો", "એક પણ કમેન્ટ કરીશ તો"],
        "a": ["તને મારી નાખીશ", "તારું માથું ફોડી નાખીશ", "તારા હાથ પગ તોડી નાખીશ"]}),
    ("hate-en-slot", "en", "hate", "high", "{g} {p}.", "I disagree with some views held by {g}.", {
        "g": GENERIC_GROUPS["en"],
        "p": ["are vermin and should be thrown out", "are subhuman", "don't deserve to live here", "are a disease on this country", "should all be wiped out"]}),
    ("hate-hi-latn-slot", "hi-Latn", "hate", "high", "{g} {p}.", "Mujhe {g} ke kuch vichaaron se asehmati hai.", {
        "g": GENERIC_GROUPS["hi-Latn"], "p": ["keede makode hain", "desh se nikalo inko", "insaan kehlane layak nahi", "samaj ki bimaari hain"]}),
    ("hate-gu-latn-slot", "gu-Latn", "hate", "high", "{g} {p}.", "Mane {g} na amuk vichaar sathe asahmati che.", {
        "g": GENERIC_GROUPS["gu-Latn"], "p": ["kida makoda che", "emne desh bahar kadho", "manas kahevay layak nathi", "samaj ni bimari che"]}),
    ("hate-hi-slot", "hi", "hate", "high", "{g} {p}।", "मुझे {g} के कुछ विचारों से असहमति है।", {
        "g": GENERIC_GROUPS["hi"], "p": ["कीड़े मकोड़े हैं", "इन्हें देश से निकालो", "इंसान कहलाने लायक नहीं"]}),
    ("hate-gu-slot", "gu", "hate", "high", "{g} {p}.", "મને {g} ના અમુક વિચારો સાથે અસહમતિ છે.", {
        "g": GENERIC_GROUPS["gu"], "p": ["કીડા મકોડા છે", "એમને દેશ બહાર કાઢો", "માણસ કહેવાય લાયક નથી"]}),
    ("harass-en-slot", "en", "harassment", "medium", "{s} {p}", "I don't think we get along right now.", {
        "s": ["Honestly,", "Everyone agrees,", "Face it,", "Just so you know,"],
        "p": ["nobody wants you here.", "everyone in this group hates you.", "you should just disappear.", "we'll make your life miserable until you leave."]}),
    ("harass-en-slot-2", "en", "harassment", "high", "{s} {p}", "Please stop contacting me like this.", {
        "s": ["Hey,", "Listen,", "Look,"],
        "p": ["go kill yourself.", "send me your pics or I'll leak your number.", "I'll keep messaging you until you reply, you can't hide.", "kys, nobody would care."]}),
    ("harass-hi-latn-slot", "hi-Latn", "harassment", "medium", "{s} {p}", "Mujhe lagta hai abhi hum sab ki raay alag hai.", {
        "s": ["Sun,", "Sach bolun toh", "Dekh,"], "p": ["koi tujhe pasand nahi karta.", "group chhod de, sab pareshan hain tujhse.", "tujhe yahan koi nahi chahta."]}),
    ("harass-gu-latn-slot", "gu-Latn", "harassment", "medium", "{s} {p}", "Mane lage che ke atyare aapni raay alag che.", {
        "s": ["Sambhal,", "Saachu kahu toh", "Jo,"], "p": ["tane koi pasand nathi kartu.", "group chhodi de, badha tarathi pareshan che.", "tane ahiya koi nathi ichhtu."]}),
]

# Extra clean content: compliments and friendly messages that use second-person words, so the
# model does not learn that "you/tu/tame" means abuse; plus more criticism of things.
CLEAN_EXTRA = {
    "en": [
        ("clean-compl-1", "compliment", "You are amazing, thanks for helping with {t}."),
        ("clean-compl-2", "compliment", "You did a fantastic job on {t}, proud of you!"),
        ("clean-compl-3", "compliment", "You're the best teammate, {t} went smoothly because of you."),
        ("clean-ask-1", "everyday", "Are you coming for {t} tomorrow?"),
        ("clean-ask-2", "everyday", "Can you send me the details about {t}?"),
        ("clean-crit-8", "criticism", "The ending of {t} was dumb, but the rest was okay."),
        ("clean-crit-9", "criticism", "I think {t} was poorly organized and nobody knew what to do."),
        ("clean-crit-10", "criticism", "Your idea for {t} won't work, the budget is too small."),
        ("clean-news-1", "everyday", "The police arrested two people after the robbery downtown."),
        ("clean-news-2", "everyday", "The documentary about the war was hard to watch but important."),
        ("clean-game-1", "everyday", "I got killed three times in the first round of the game, lol."),
    ],
    "hi-Latn": [
        ("clean-compl-1", "compliment", "Tu bahut achha hai yaar, {t} mein help ke liye thanks."),
        ("clean-compl-2", "compliment", "Tum sach mein kamaal ho, {t} ekdum perfect tha."),
        ("clean-ask-1", "everyday", "Tum kal {t} ke liye aa rahe ho kya?"),
        ("clean-ask-2", "everyday", "Kya tum mujhe {t} ki details bhej sakte ho?"),
        ("clean-crit-4", "criticism", "Tumhara {t} wala idea kaam nahi karega, budget kam hai."),
        ("clean-crit-5", "criticism", "{t} ka ending bekaar tha, baaki theek tha."),
    ],
    "gu-Latn": [
        ("clean-compl-1", "compliment", "Tu bahu saro che yaar, {t} ma madad mate aabhar."),
        ("clean-compl-2", "compliment", "Tame kharekhar kamaal cho, {t} ekdam perfect hatu."),
        ("clean-ask-1", "everyday", "Tame kale {t} mate aavo cho?"),
        ("clean-ask-2", "everyday", "Shu tame mane {t} ni vigat moklashe?"),
        ("clean-crit-4", "criticism", "Tamaro {t} vado idea nahi chale, budget ochhu che."),
        ("clean-crit-5", "criticism", "{t} no ant bekar hato, baaki thik hatu."),
    ],
    "hi": [
        ("clean-compl-1", "compliment", "तुम बहुत अच्छे हो, {t} में मदद के लिए धन्यवाद।"),
        ("clean-ask-1", "everyday", "क्या तुम कल {t} के लिए आ रहे हो?"),
        ("clean-crit-4", "criticism", "तुम्हारा {t} वाला आइडिया काम नहीं करेगा, बजट कम है।"),
    ],
    "gu": [
        ("clean-compl-1", "compliment", "તું બહુ સારો છે, {t} માં મદદ માટે આભાર."),
        ("clean-ask-1", "everyday", "શું તમે કાલે {t} માટે આવો છો?"),
        ("clean-crit-4", "criticism", "તમારો {t} વાળો આઇડિયા નહીં ચાલે, બજેટ ઓછું છે."),
    ],
    "hinglish": [
        ("clean-compl-1", "compliment", "Bro tu legend hai, {t} was absolutely perfect."),
        ("clean-ask-1", "everyday", "Tum log {t} ke liye ready ho? Let's go!"),
        ("clean-crit-3", "criticism", "Sach bolu toh {t} was overhyped, utna bhi achha nahi tha."),
    ],
    "en-gu": [
        ("clean-compl-1", "compliment", "You did great today, tame {t} ma saras kaam karyu."),
        ("clean-ask-1", "everyday", "Are you free kale? Let's finish {t} together."),
        ("clean-crit-1", "criticism", "Honestly {t} was bekar, but next time saru thase."),
    ],
}
TOPICS["en-gu"] = TOPICS["en"]

CLEAN_FILLERS = {
    "en": ["I hope everyone had a good weekend.", "Let's discuss this in the next meeting.", "Thanks for sharing your thoughts.", "The weather has been great lately."],
    "hi-Latn": ["Sabka weekend achha raha hoga.", "Agli meeting mein is par baat karte hain.", "Share karne ke liye dhanyavaad."],
    "gu-Latn": ["Badhano weekend saro gayo hase.", "Aavti meeting ma aa vishe vaat kariye.", "Share karva badal aabhar."],
    "hi": ["सबका सप्ताहांत अच्छा रहा होगा।", "अगली मीटिंग में इस पर बात करते हैं।"],
    "gu": ["બધાનો સપ્તાહાંત સારો ગયો હશે.", "આવતી મીટિંગમાં આ વિશે વાત કરીએ."],
    "hinglish": ["Guys weekend kaisa gaya?", "Next meeting mein discuss karte hain, okay?"],
}


# ---------------------------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------------------------
def words_for(lang, categories):
    base = {"hinglish": "hi-Latn"}.get(lang, lang)
    return [e for e in L if e["lang"] == base and e["category"] in categories and " " not in e["term"]]


def build_words():
    rows = []
    for e in L:
        name, script = LANG[e["lang"]]
        forms = [(e["term"], "none")] + [(v, "variant") for v in e["variants"]]
        if is_latin(e["term"]):
            for kind in ("leet", "spaced", "repeated"):
                forms.append((OBFUSCATORS[kind](e["term"]), kind))
        seen = set()
        for text, obf in forms:
            if text.lower() in seen:
                continue
            seen.add(text.lower())
            rows.append(dict(
                text=text, language=name, language_code=e["lang"], script=script,
                transliteration=e["translit"] or (e["term"] if is_latin(e["term"]) else ""),
                category=e["category"], severity=e["severity"], is_inappropriate=True,
                context_dependent=e["context"], safe_replacement=e["replacement"],
                explanation=e["explanation"], base_term=e["term"], obfuscation=obf,
                template_group=f"word:{e['lang']}:{e['translit'] or e['term']}",
            ))
    for text, lang, why in HARD_NEGATIVE_WORDS:
        name, script = LANG[lang]
        rows.append(dict(
            text=text, language=name, language_code=lang, script=script, transliteration=text if script == "Latin" else "",
            category="clean", severity="none", is_inappropriate=False, context_dependent=False, safe_replacement="",
            explanation=why, base_term=text, obfuscation="none", template_group=f"word:{lang}:clean:{text}",
        ))
    return rows


def maybe_obfuscate(word):
    """Return (text, kind). About 35% of abusive words are disguised."""
    if not is_latin(word) or rng.random() > 0.35:
        return word, "none"
    kind = rng.choice(list(OBFUSCATORS))
    return OBFUSCATORS[kind](word), kind


def build_sentences():
    rows = []
    for lang, templates in INSULT_TEMPLATES.items():
        insults = words_for(lang, {"insult"})
        for tid, tpl, rewrite in templates:
            topics = TOPICS[lang]
            for e in rng.sample(insults, min(len(insults), 7)):
                word, obf = maybe_obfuscate(rng.choice([e["term"]] + e["variants"][:2]))
                t = rng.choice(topics)
                rows.append(dict(
                    text=tpl.format(w=word, t=t), language_code=lang, category="insult",
                    severity="high" if e["severity"] == "high" else "medium", is_inappropriate=True,
                    safe_rewritten_text=rewrite.format(t=t), explanation=f"Insults a person with '{e['term']}'.",
                    obfuscation=obf, template_group=f"{lang}:{tid}",
                ))
    for lang, templates in PROFANITY_TEMPLATES.items():
        prof = words_for(lang, {"profanity"})
        for tid, tpl, rewrite in templates:
            for e in rng.sample(prof, min(len(prof), 5)):
                word, obf = maybe_obfuscate(e["term"])
                t = rng.choice(TOPICS[lang])
                severity = e["severity"]
                rows.append(dict(
                    text=tpl.format(w=word, t=t).replace("  ", " "), language_code=lang, category="profanity",
                    severity=severity, is_inappropriate=True, safe_rewritten_text=rewrite.format(t=t),
                    explanation=f"Uses profanity ('{e['term']}') without targeting a person.",
                    obfuscation=obf, template_group=f"{lang}:{tid}",
                ))
    for tid, lang, category, severity, text, rewrite in FIXED:
        rows.append(dict(
            text=text, language_code=lang, category=category, severity=severity, is_inappropriate=True,
            safe_rewritten_text=rewrite, explanation={
                "threat": "Threatens violence against a person.",
                "harassment": "Targets a person with harassment or degrading slurs.",
                "hate": "Dehumanizes or excludes a group of people.",
            }[category], obfuscation="none", template_group=f"{lang}:{tid}",
        ))
    explain = {
        "threat": "Threatens violence against a person.",
        "harassment": "Targets a person with harassment or degrading slurs.",
        "hate": "Dehumanizes or excludes a group of people.",
    }
    for tid, lang, category, severity, tpl, rewrite, slots in SLOTTED:
        keys = list(slots)
        combos = set()
        while len(combos) < min(8, len(slots[keys[0]]) * len(slots[keys[1]])):
            combos.add(tuple(rng.choice(slots[k]) for k in keys))
        for combo in sorted(combos):
            values = dict(zip(keys, combo))
            rows.append(dict(
                text=tpl.format(**values), language_code=lang, category=category, severity=severity, is_inappropriate=True,
                safe_rewritten_text=rewrite.format(**values), explanation=explain[category], obfuscation="none",
                template_group=f"{lang}:{tid}",
            ))
    # Paragraphs: one abusive sentence among clean ones; the rewrite changes only that sentence
    base = list(rows)
    for row in rng.sample(base, min(len(base), 160)):
        lang = row["language_code"]
        fillers = CLEAN_FILLERS.get(lang, CLEAN_FILLERS["en"])
        before = rng.sample(fillers, rng.randint(1, min(2, len(fillers))))
        after = rng.sample(fillers, rng.randint(0, 1))
        rows.append(dict(
            row,
            text=" ".join(before + [row["text"]] + after),
            safe_rewritten_text=" ".join(before + [row["safe_rewritten_text"]] + after),
            explanation=row["explanation"] + " (Paragraph: only the abusive sentence needs rewriting.)",
        ))
    for r in rows:
        r["language"], r["script"] = LANG[r["language_code"]]
    return rows


def build_clean():
    rows = []
    merged = {lang: CLEAN.get(lang, []) + CLEAN_EXTRA.get(lang, []) for lang in set(CLEAN) | set(CLEAN_EXTRA)}
    for lang, templates in sorted(merged.items()):
        for tid, kind, tpl in templates:
            fills = rng.sample(TOPICS[lang], 6) if "{t}" in tpl else [None]
            for t in fills:
                text = tpl.format(t=t) if t else tpl
                rows.append(dict(
                    text=text, language_code=lang, category="clean", subcategory=kind, is_inappropriate=False,
                    explanation={
                        "criticism": "Negative opinion about a thing or decision, without abuse.",
                        "disagreement": "Respectful disagreement.",
                        "joke": "Harmless humour.",
                        "idiom": "Violent-sounding idiom with a harmless meaning.",
                        "everyday": "Ordinary conversation; may contain look-alike words.",
                        "negative-emotion": "Expresses frustration without attacking anyone.",
                        "compliment": "Friendly message addressed to a person.",
                    }[kind],
                    template_group=f"{lang}:{tid}",
                ))
    for lang, texts in CLEAN_GENERIC.items():
        for i, text in enumerate(texts, start=1):
            rows.append(dict(
                text=text, language_code=lang, category="clean", subcategory="everyday", is_inappropriate=False,
                explanation="Ordinary everyday post.", template_group=f"{lang}:generic-{i}",
            ))
    # Clean paragraphs padded with the SAME filler sentences used around abusive sentences in
    # build_sentences(), in similar numbers. Without this, the fillers ("I hope everyone had a good
    # weekend") only ever appeared in inappropriate rows and the model learned them as abuse signals.
    singles = list(rows)
    for row in rng.sample(singles, min(len(singles), 200)):
        lang = row["language_code"]
        fillers = CLEAN_FILLERS.get(lang, CLEAN_FILLERS["en"])
        before = rng.sample(fillers, rng.randint(1, min(2, len(fillers))))
        after = rng.sample(fillers, rng.randint(0, 1))
        rows.append(dict(
            row, text=" ".join(before + [row["text"]] + after), subcategory="paragraph",
            explanation="Clean paragraph (same filler sentences as the abusive paragraphs).",
        ))
    # Clean paragraphs built from clean sentences of the same language
    by_lang = {}
    for r in rows:
        by_lang.setdefault(r["language_code"], []).append(r)
    for lang, items in by_lang.items():
        for _ in range(25):
            picks = rng.sample(items, min(3, len(items)))
            rows.append(dict(
                text=" ".join(p["text"] for p in picks), language_code=lang, category="clean", subcategory="paragraph",
                is_inappropriate=False, explanation="Multi-sentence clean paragraph.",
                template_group=f"{lang}:clean-para:" + "+".join(sorted(p["template_group"] for p in picks)),
            ))
    for r in rows:
        r["language"], r["script"] = LANG[r["language_code"]]
    return rows


def build_mixed():
    rows = []
    for tid, lang, category, severity, text, rewrite in MIXED:
        rows.append(dict(
            text=text, language_code=lang, category=category, severity=severity, is_inappropriate=category != "clean",
            safe_rewritten_text=rewrite or "", explanation="Mixed-language example." if category == "clean"
            else f"Mixed-language {category}.", template_group=f"{lang}:{tid}",
        ))
    # Generated code-mixed sentences: English frame + Hindi/Gujarati abusive or clean phrase
    frames = [
        ("mixgen-1", "Honestly {x}, I can't believe {t} happened again."),
        ("mixgen-2", "Guys, {x}, let's finish {t} today please."),
        ("mixgen-3", "So {x}, what's the update on {t}?"),
    ]
    abusive = [("hinglish", "tu sach mein {w} hai", "insult"), ("en-gu", "tu sav {w} che", "insult")]
    clean = [("hinglish", "yaar bahut thak gaya hoon"), ("en-gu", "aaje bahu kaam che"), ("hinglish", "chhod do ye sab"), ("en-gu", "tame saru kam karyu")]
    for fid, frame in frames:
        for lang, phrase, category in abusive:
            for e in rng.sample(words_for("hi-Latn" if lang == "hinglish" else "gu-Latn", {"insult"}), 5):
                word, obf = maybe_obfuscate(e["term"])
                t = rng.choice(TOPICS["en"])
                rows.append(dict(
                    text=frame.format(x=phrase.format(w=word), t=t), language_code=lang, category="insult",
                    severity="high" if e["severity"] == "high" else "medium", is_inappropriate=True,
                    safe_rewritten_text=frame.format(x="yaar", t=t), explanation=f"Mixed-language insult ('{e['term']}').",
                    obfuscation=obf, template_group=f"{lang}:{fid}",
                ))
        for lang, phrase in clean:
            for t in rng.sample(TOPICS["en"], 3):
                rows.append(dict(
                    text=frame.format(x=phrase, t=t), language_code=lang, category="clean", severity="none",
                    is_inappropriate=False, safe_rewritten_text="", explanation="Clean code-mixed sentence.",
                    obfuscation="none", template_group=f"{lang}:{fid}-clean",
                ))
    for r in rows:
        r["language"], r["script"] = LANG[r["language_code"]]
        r.setdefault("obfuscation", "none")
    return rows


def dedupe(rows):
    seen, out = set(), []
    for r in rows:
        key = " ".join(r["text"].lower().split())
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def main():
    words = dedupe(build_words())
    sentences = dedupe(build_sentences())
    clean = dedupe(build_clean())
    mixed = dedupe(build_mixed())

    def frame(rows, columns, prefix):
        df = pd.DataFrame(rows)
        for c in columns:
            if c not in df.columns:
                df[c] = ""
        df.insert(0, "id", [f"{prefix}-{i:05d}" for i in range(1, len(df) + 1)])
        df["synthetic"] = True
        return df[["id"] + columns + ["synthetic"]]

    sheets = OrderedDict()
    sheets["Vulgar Words"] = frame(words, ["text", "language", "language_code", "script", "transliteration", "category", "severity",
                                           "is_inappropriate", "context_dependent", "safe_replacement", "explanation", "base_term",
                                           "obfuscation", "template_group"], "W")
    sheets["Vulgar Sentences"] = frame(sentences, ["text", "language", "language_code", "script", "category", "severity",
                                                   "is_inappropriate", "safe_rewritten_text", "explanation", "obfuscation",
                                                   "template_group"], "S")
    sheets["Clean Content"] = frame(clean, ["text", "language", "language_code", "script", "category", "subcategory",
                                            "is_inappropriate", "explanation", "template_group"], "C")
    sheets["Mixed Language"] = frame(mixed, ["text", "language", "language_code", "script", "category", "severity",
                                             "is_inappropriate", "safe_rewritten_text", "explanation", "obfuscation",
                                             "template_group"], "M")

    all_rows = pd.concat([df.assign(sheet=name) for name, df in sheets.items()], ignore_index=True)
    all_rows["severity"] = all_rows["severity"].replace("", "none").fillna("none")
    stats = []
    stats.append(("Total", "total examples", len(all_rows)))
    for name, df in sheets.items():
        stats.append(("Rows per sheet", name, len(df)))
    for (k, v) in all_rows["is_inappropriate"].map({True: "inappropriate", False: "clean"}).value_counts().items():
        stats.append(("Inappropriate vs clean", k, int(v)))
    for k, v in all_rows["language"].value_counts().items():
        stats.append(("Examples per language", k, int(v)))
    for k, v in all_rows["category"].value_counts().items():
        stats.append(("Examples per category", k, int(v)))
    for k, v in all_rows["severity"].value_counts().items():
        stats.append(("Examples per severity", k, int(v)))
    for k, v in all_rows["obfuscation"].replace("", "none").fillna("none").value_counts().items():
        stats.append(("Obfuscation", k, int(v)))
    stats.append(("Note", "All rows are SYNTHETIC (generated from templates, seed %d). Not representative of all real-world usage." % SEED, ""))
    sheets["Statistics"] = pd.DataFrame(stats, columns=["section", "item", "count"])

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(OUTPUT, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            ws.freeze_panes = "A2"
            for col in ws.columns:
                width = min(60, max(10, max(len(str(c.value or "")) for c in col[:200]) + 2))
                ws.column_dimensions[col[0].column_letter].width = width

    print(f"Wrote {OUTPUT}")
    for name, df in sheets.items():
        print(f"  {name}: {len(df)} rows")


if __name__ == "__main__":
    main()

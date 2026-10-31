# Moderation model evaluation

Generated 2026-10-31T15:20:36+00:00 by `evaluation/evaluate.py`.

> **Synthetic data warning.** Every number below is measured on a held-out split of a synthetic, template-generated
> dataset (templates never straddle splits). Test sentences still resemble training sentences, so real-world accuracy
> on genuine posts is unknown and expected to be lower. The probe set is small and hand-written.

- Rows: train 1900, validation 378, test 396 (grouped by template; clean counterparts included)
- Thresholds tuned on validation: block = lowest with precision >= 95%; uncertain = lowest keeping <= 5% of clean validation texts held back
- **Deployed model: baseline** (chosen by validation F1 of the full policy)

## Model comparison (test split)

| | Baseline: TF-IDF + logistic regression | Fine-tuned DistilBERT-multilingual |
|---|---|---|
| Raw classifier: 7-label accuracy | 85.6% | not trained |
| Raw classifier: 7-label macro F1 | 69.9% | not trained |
| Thresholds (block / uncertain) | 0.6 / 0.5 | not trained |
| **Policy on sentences: precision** | 90.1% | not trained |
| **Policy on sentences: recall** | 93.2% | not trained |
| **Policy on sentences: F1** | 91.6% | not trained |
| Policy accuracy | 94.4% | not trained |
| Share held as 'uncertain' | 3.9% | not trained |
| Category accuracy (blocked toxic) | 89.9% | not trained |
| False positives / false negatives | 12 / 8 | not trained |
| Unseen single words blocked | 17.5% | not trained |
| Probe set (n=38): accuracy | 92.1% | not trained |
| Probe: clean texts blocked | 3 | not trained |
| Probe: toxic texts allowed | 0 | not trained |
| Latency per text (median / p95) | 3 / 6 ms | not trained |

"Policy" = what the service does: word list (training words only during evaluation) + model + thresholds; a text counts as blocked when the decision is `block` or `uncertain`.

## tfidf-char-logreg

Policy confusion matrix on test sentences (rows = true, columns = predicted):

| | allowed | blocked |
|---|---|---|
| **clean** | 226 | 12 |
| **toxic** | 8 | 109 |

Category confusion among blocked toxic texts (rows = true, cols = predicted; MILD_PROFANITY, VULGAR, PERSONAL_ABUSE, HARASSMENT, HATE_SPEECH, THREAT):

```
MILD_PROFANITY     9    0    1    0    0    0
VULGAR             0   24    1    0    0    0
PERSONAL_ABUSE     0    0   59    2    0    0
HARASSMENT         0    0    0    5    0    5
HATE_SPEECH        0    0    0    1    0    0
THREAT             0    0    0    1    0    1
```

| Language | n | Accuracy | Precision | Recall | F1 |
|---|---|---|---|---|---|
| en | 74 | 98.6% | 95.8% | 100.0% | 97.9% |
| en-gu | 32 | 100.0% | 100.0% | 100.0% | 100.0% |
| en-gu-script | 2 | too few test examples for a reliable estimate |  |  |  |
| gu | 31 | 77.4% | 58.3% | 77.8% | 66.7% |
| gu-Latn | 47 | 97.9% | 90.0% | 100.0% | 94.7% |
| hi | 4 | too few test examples for a reliable estimate |  |  |  |
| hi-Latn | 137 | 93.4% | 95.0% | 90.5% | 92.7% |
| hinglish | 28 | 92.9% | 75.0% | 100.0% | 85.7% |

False positives (clean text blocked):

- `hinglish` uncertain → PERSONAL_ABUSE (0.558): Diwali ki shopping done, ab bas mithai ka wait.
- `hinglish` uncertain → PERSONAL_ABUSE (0.543): Next meeting mein discuss karte hain, okay? Guys weekend kaisa gaya? Diwali ki shopping done, ab bas mithai ka wait. Next meeting mein discuss karte hain, okay?
- `gu-Latn` uncertain → PERSONAL_ABUSE (0.545): Gandhinagar ma aaje varsad padyo, mosam saras che.
- `hi-Latn` block → PERSONAL_ABUSE (0.754): Monday ko dekhte hi meri neend bhaag jaati hai.
- `hi-Latn` block → PERSONAL_ABUSE (0.61): Barish mein garam chai aur pakode, aur kya chahiye.
- `hi-Latn` block → PERSONAL_ABUSE (0.671): Agli meeting mein is par baat karte hain. Monday ko dekhte hi meri neend bhaag jaati hai.
- `en` uncertain → THREAT (0.511): The weather has been great lately. Enjoy your weekend, friends! Thanks for sharing your thoughts.
- `gu` uncertain → PERSONAL_ABUSE (0.548): મારા બોસે અન્યાય કર્યો, ગ્રુપ નો દોષ મારા પર નાખ્યો.
- `gu` uncertain → PERSONAL_ABUSE (0.518): મારા બોસે અન્યાય કર્યો, પરીક્ષા નો દોષ મારા પર નાખ્યો.
- `gu` uncertain → PERSONAL_ABUSE (0.579): મારા બોસે અન્યાય કર્યો, પ્લાન નો દોષ મારા પર નાખ્યો.
- `gu` uncertain → PERSONAL_ABUSE (0.554): મારા બોસે અન્યાય કર્યો, ઓર્ડર નો દોષ મારા પર નાખ્યો.
- `gu` uncertain → PERSONAL_ABUSE (0.574): આવતી મીટિંગમાં આ વિશે વાત કરીએ. મારા બોસે અન્યાય કર્યો, પરીક્ષા નો દોષ મારા પર નાખ્યો.

False negatives (toxic text allowed):

- `gu` HARASSMENT (0.679): આ છોકરી તો રાંડ છે, આખો દિવસ ફોટા મૂકે છે.
- `gu` HARASSMENT (0.662): બધાનો સપ્તાહાંત સારો ગયો હશે. આ છોકરી તો રાંડ છે, આખો દિવસ ફોટા મૂકે છે.
- `hi-Latn` MILD_PROFANITY (0.597): Kya saa*a hai ye kaam.
- `hi-Latn` PERSONAL_ABUSE (0.626): Share karne ke liye dhanyavaad. Sabka weekend achha raha hoga. Mera boss pura gadhaa hai, trip ka blame mujh pe daal diya. Agli meeting mein is par baat karte hain.
- `hi-Latn` PERSONAL_ABUSE (0.554): Share karne ke liye dhanyavaad. Kaun bevakoof ne report aise banaya? Sabka weekend achha raha hoga.
- `hi-Latn` PERSONAL_ABUSE (0.595): Share karne ke liye dhanyavaad. Sabka weekend achha raha hoga. Abe c-h-o-o-t-i-y-a, deadline pe dhyan de. Agli meeting mein is par baat karte hain.
- `hi-Latn` PERSONAL_ABUSE (0.585): Share karne ke liye dhanyavaad. Mera boss pura chootiya hai, trip ka blame mujh pe daal diya. Sabka weekend achha raha hoga.
- `hi-Latn` MILD_PROFANITY (0.638): Sabka weekend achha raha hoga. Kya saa*a hai ye kaam. Share karne ke liye dhanyavaad.

Probe set:

| Text | Expected | Decision | Category | Confidence |
|---|---|---|---|---|
| Hope you all had a relaxing holiday | CLEAN | block | PERSONAL_ABUSE | 0.769 |
| The lecture today was boring but the professor clearly knows the subject. | CLEAN | allow | CLEAN | 0.96 |
| Can someone explain why the train is delayed again? This is ridiculous. | CLEAN | allow | CLEAN | 0.71 |
| I completely disagree with your take on remote work. | CLEAN | allow | CLEAN | 0.935 |
| My laptop died in the middle of the presentation, worst timing ever. | CLEAN | allow | CLEAN | 0.7 |
| Just got my first paycheck and spent half of it on books. | CLEAN | allow | CLEAN | 0.586 |
| That referee made some terrible decisions in the second half. | CLEAN | allow | CLEAN | 0.867 |
| Selling my old cycle, message me if interested. | CLEAN | allow | CLEAN | 0.625 |
| Feeling a bit low today, a long walk should help. | CLEAN | block | VULGAR | 0.828 |
| Who else thinks pineapple belongs on pizza? | CLEAN | allow | CLEAN | 0.804 |
| Your presentation had too many slides, but the conclusion was strong. | CLEAN | allow | CLEAN | 0.922 |
| Aaj office mein bahut kaam tha, ab bas sona hai. | CLEAN | allow | CLEAN | 0.901 |
| Yeh restaurant ka khana bilkul achha nahi tha, service bhi slow thi. | CLEAN | allow | CLEAN | 0.77 |
| Bhai tu sahi bol raha hai, mujhe bhi wahi laga. | CLEAN | uncertain | PERSONAL_ABUSE | 0.584 |
| Kal ki trip cancel ho gayi, mood off hai yaar. | CLEAN | allow | CLEAN | 0.722 |
| Aaje ghare mehmaan aavya hata, aakho divas vyast rahyo. | CLEAN | allow | CLEAN | 0.794 |
| Tamari vaat sachi che, pan maro vichar thodo alag che. | CLEAN | allow | CLEAN | 0.711 |
| आज बहुत गर्मी है, बाहर निकलना मुश्किल है। | CLEAN | allow | CLEAN | 0.822 |
| यह फिल्म मुझे बिल्कुल पसंद नहीं आई। | CLEAN | allow | CLEAN | 0.886 |
| આજે ખૂબ ગરમી છે, બહાર જવું મુશ્કેલ છે. | CLEAN | allow | CLEAN | 0.715 |
| આ ફિલ્મ મને જરાય ન ગમી. | CLEAN | allow | CLEAN | 0.834 |
| Damn it, I left my umbrella at the office again. | MILD_PROFANITY | block | MILD_PROFANITY | 0.961 |
| This shit app keeps crashing, what a fucking joke. | VULGAR | block | VULGAR | 0.997 |
| Bhenchod yeh wifi phir se band ho gaya. | VULGAR | block | VULGAR | 0.969 |
| Shut the hell up, nobody cares about your stupid opinion, idiot. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.566 |
| Abe saale harami, mera paisa wapas kar warna dekh lena. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.797 |
| Tu kitna bada chutiya hai bhai, ek kaam dhang se nahi hota. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.978 |
| Tu sav nalayak ane gadhedo che, kai kaam nathi aavadtu. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.994 |
| Ae bhosdina, maro phone pachho aap. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.896 |
| तू कमीना है, तुझे शर्म नहीं आती? | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.918 |
| તું નાલાયક છે, તને કંઈ આવડતું નથી. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.959 |
| Listen idiot, aaje pan late aavyo, sharam kar. | PERSONAL_ABUSE | block | PERSONAL_ABUSE | 0.868 |
| You're a pathetic loser and everyone laughs at you behind your back. | HARASSMENT | block | PERSONAL_ABUSE | 0.932 |
| go and kys, nobody will miss u | HARASSMENT | block | HARASSMENT | 0.719 |
| People like them are animals and should not be allowed in our city. | HATE_SPEECH | block | HATE_SPEECH | 0.871 |
| Wait till I catch you after school, you'll be in the hospital. | THREAT | block | THREAT | 0.811 |
| Kal college aa, tujhe chhodunga nahi, haath pair tod dunga. | THREAT | block | THREAT | 0.988 |
| तुझे देख लूंगा, बच के रहना। | THREAT | block | THREAT | 0.921 |


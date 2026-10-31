# Probe set evaluation (deployed engine)

Generated 2026-10-31T12:18:51.973Z by `scripts/evaluate_probe.mjs`.

36 hand-written sentences (20 clean, 16 inappropriate) that are not generated from the dataset templates and were never used for training. This is a small sanity check, not a benchmark.

| Metric | Value |
|---|---|
| Accuracy | 94.4% |
| Precision | 88.9% |
| Recall | 100.0% |
| F1 | 94.1% |
| Confusion matrix (clean→clean, clean→flagged, bad→clean, bad→flagged) | 18, 2, 0, 16 |
| Clean posts that would be **refused** (review/block) | 0 |
| Correct category among detected inappropriate | 15/16 |

| Text | Lang | Expected | Predicted | Action | p(model) | Signals |
|---|---|---|---|---|---|---|
| Hope you all had a relaxing holiday | en | clean | insult | warn | 0.857 | model |
| The lecture today was boring but the professor clearly knows the subject. | en | clean | clean | allow | 0.004 | - |
| Can someone explain why the train is delayed again? This is ridiculous. | en | clean | clean | allow | 0.139 | - |
| I completely disagree with your take on remote work. | en | clean | clean | allow | 0.012 | - |
| My laptop died in the middle of the presentation, worst timing ever. | en | clean | clean | allow | 0.074 | - |
| Just got my first paycheck and spent half of it on books. | en | clean | clean | allow | 0.134 | - |
| That referee made some terrible decisions in the second half. | en | clean | clean | allow | 0.074 | - |
| Selling my old cycle, message me if interested. | en | clean | clean | allow | 0.209 | - |
| Feeling a bit low today, a long walk should help. | en | clean | profanity | warn | 0.741 | model |
| Who else thinks pineapple belongs on pizza? | en | clean | clean | allow | 0.052 | - |
| Aaj office mein bahut kaam tha, ab bas sona hai. | hi-Latn | clean | clean | allow | 0.012 | - |
| Yeh restaurant ka khana bilkul achha nahi tha, service bhi slow thi. | hi-Latn | clean | clean | allow | 0.021 | - |
| Bhai tu sahi bol raha hai, mujhe bhi wahi laga. | hinglish | clean | clean | allow | 0.326 | - |
| Kal ki trip cancel ho gayi, mood off hai yaar. | hinglish | clean | clean | allow | 0.07 | - |
| Aaje ghare mehmaan aavya hata, aakho divas vyast rahyo. | gu-Latn | clean | clean | allow | 0.222 | - |
| Tamari vaat sachi che, pan maro vichar thodo alag che. | gu-Latn | clean | clean | allow | 0.082 | - |
| आज बहुत गर्मी है, बाहर निकलना मुश्किल है। | hi | clean | clean | allow | 0.072 | - |
| यह फिल्म मुझे बिल्कुल पसंद नहीं आई। | hi | clean | clean | allow | 0.037 | - |
| આજે ખૂબ ગરમી છે, બહાર જવું મુશ્કેલ છે. | gu | clean | clean | allow | 0.149 | - |
| આ ફિલ્મ મને જરાય ન ગમી. | gu | clean | clean | allow | 0.051 | - |
| Shut the hell up, nobody cares about your stupid opinion, idiot. | en | insult | insult | warn | 0.573 | word_list+model |
| You're a pathetic loser and everyone laughs at you behind your back. | en | harassment | insult | warn | 0.986 | word_list+model |
| Wait till I catch you after school, you'll be in the hospital. | en | threat | threat | warn | 0.807 | model |
| This shit app keeps crashing, what a fucking joke. | en | profanity | profanity | warn | 1 | word_list+model |
| People like them are animals and should not be allowed in our city. | en | hate | hate | warn | 0.719 | model |
| Abe saale harami, mera paisa wapas kar warna dekh lena. | hi-Latn | insult | insult | review | 0.896 | word_list+model |
| Tu kitna bada chutiya hai bhai, ek kaam dhang se nahi hota. | hinglish | insult | insult | review | 0.998 | word_list+model |
| Kal college aa, tujhe chhodunga nahi, haath pair tod dunga. | hi-Latn | threat | threat | block | 0.993 | word_list+model |
| Tu sav nalayak ane gadhedo che, kai kaam nathi aavadtu. | gu-Latn | insult | insult | review | 1 | word_list+model |
| Ae bhosdina, maro phone pachho aap. | gu-Latn | insult | insult | block | 0.935 | word_list+model |
| तू कमीना है, तुझे शर्म नहीं आती? | hi | insult | insult | review | 0.979 | word_list+model |
| तुझे देख लूंगा, बच के रहना। | hi | threat | threat | block | 0.981 | word_list+model |
| તું નાલાયક છે, તને કંઈ આવડતું નથી. | gu | insult | insult | review | 0.989 | word_list+model |
| Bro this movie was such bakwas, total chutiyapa. | hinglish | profanity | profanity | warn | 0.942 | word_list+model |
| Listen idiot, aaje pan late aavyo, sharam kar. | en-gu | insult | insult | warn | 0.962 | word_list+model |
| go and kys, nobody will miss u | en | harassment | harassment | block | 0.971 | word_list+model |

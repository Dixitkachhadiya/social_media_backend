# Moderation model evaluation

Generated 2026-10-31T12:07:42+00:00 by `training/train.py`.

> **Read this first.** All numbers are measured on a held-out split of a **synthetic, template-generated** dataset.
> The split keeps every template in one split only, but test sentences still share vocabulary and style with training data.
> Real-world performance on genuine user posts is unknown and is expected to be lower. Review real examples before relying on it.

- Rows used: 2406 (train 1717, validation 288, test 401); GroupShuffleSplit by template_group (70/15/15)
- Model: LogisticRegression(C=30.0, class_weight=balanced) on char_wb 2-5-gram TF-IDF; 12029 exported features
- Thresholds (chosen on validation): flag >= 0.3, confident >= 0.3

## Inappropriate vs clean (test split, sentences and paragraphs)

The combined row applies the deployed engine policy: classifier-only results need p >= 0.5 and at least 3 words.

| System | Accuracy | Precision | Recall | F1 |
|---|---|---|---|---|
| Word list only (baseline) | 80.1% | 100.0% | 38.3% | 55.4% |
| Classifier only | 90.3% | 80.5% | 92.5% | 86.1% |
| Combined (as used by the backend) | 92.1% | 92.6% | 82.2% | 87.1% |

Combined confusion matrix (rows = true, columns = predicted):

| | predicted clean | predicted inappropriate |
|---|---|---|
| **clean** | 217 | 7 |
| **inappropriate** | 19 | 88 |

## Category accuracy (combined system)

Accuracy 88.5%, macro F1 77.7%

| Category | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| clean | 91.9% | 96.9% | 94.3% | 224 |
| profanity | 80.0% | 66.7% | 72.7% | 6 |
| insult | 74.4% | 80.0% | 77.1% | 40 |
| harassment | 100.0% | 53.8% | 70.0% | 26 |
| threat | 61.1% | 84.6% | 71.0% | 13 |
| hate | 100.0% | 68.2% | 81.1% | 22 |

Category confusion matrix (rows = true, columns = predicted; order: clean, profanity, insult, harassment, threat, hate):

```
clean        217    0    5    0    2    0
profanity      1    4    1    0    0    0
insult         7    1   32    0    0    0
harassment     4    0    3   14    5    0
threat         2    0    0    0   11    0
hate           5    0    2    0    0   15
```

## Abusive single words missing from the word list

69 test words whose terms were held out of the word list: classifier alone detects 100.0%; the deployed engine detects 2.9% (a lone word is decided by the word list only). New slang must be added to the word list (Vulgar Words sheet) to be caught on its own.

## Per language (combined, binary)

| Language | n | Accuracy | Precision | Recall | F1 |
|---|---|---|---|---|---|
| en | 95 | 85.3% | 78.3% | 66.7% | 72.0% |
| en-gu | 23 | 100.0% | 100.0% | 100.0% | 100.0% |
| en-gu-script | 2 | too few test examples for a reliable estimate | | | |
| en-hi-gu | 2 | too few test examples for a reliable estimate | | | |
| gu | 49 | 95.9% | 100.0% | 86.7% | 92.9% |
| gu-Latn | 53 | 96.2% | 95.7% | 95.7% | 95.7% |
| hi | 45 | 84.4% | 94.7% | 75.0% | 83.7% |
| hi-Latn | 36 | 97.2% | 100.0% | 90.9% | 95.2% |
| hinglish | 26 | 100.0% | 0.0% | 0.0% | 0.0% |

## False positives (clean text flagged)

- `gu-Latn` p=0.5 → threat: Share karva badal aabhar. Aavti meeting ma aa vishe vaat kariye. meeting kone aavu banavyu? Ema sudharo joie. Share karva badal aabhar.
- `en` p=0.585 → insult: Are you coming for the project tomorrow?
- `en` p=0.515 → insult: Are you coming for the presentation tomorrow?
- `en` p=0.605 → insult: Are you coming for the update tomorrow?
- `en` p=0.552 → insult: Are you coming for the plan tomorrow?
- `en` p=0.743 → threat: Are you coming for your code tomorrow?
- `hi` p=0.515 → insult: सबका सप्ताहांत अच्छा रहा होगा। मेरा कुत्ता बहुत प्यारा है, रोज़ सुबह घूमने जाता है। सबका सप्ताहांत अच्छा रहा होगा।

## False negatives (inappropriate text missed)

- `en` p=0.211 (insult): Stop acting like a d1ck*ead and fix this group chat.
- `en` p=0.223 (insult): Stop acting like a jerkkk and fix the match.
- `en` p=0.126 (insult): Stop acting like a baste*d and fix the delivery.
- `en` p=0.412 (insult): Stop acting like a idiat and fix the plan.
- `gu` p=0.5 (insult): કયા ભોસડીના એ રિપોર્ટ આવું બનાવ્યું?
- `en` p=0.034 (profanity): this group chat was a load of s*it honestly.
- `hi` p=0.424 (threat): एक और कमेंट किया तो हाथ पैर तोड़ दूंगा।
- `hi-Latn` p=0.475 (hate): ye bahar wale insaan kehlane layak nahi.
- `hi` p=0.373 (hate): उस धर्म के लोग इंसान कहलाने लायक नहीं।
- `hi` p=0.22 (hate): ये बाहर वाले इंसान कहलाने लायक नहीं।
- `en` p=0.399 (harassment): Everyone agrees, everyone in this group hates you.
- `en` p=0.47 (harassment): Everyone agrees, you should just disappear.
- `en` p=0.315 (insult): Let's discuss this in the next meeting. The weather has been great lately. Stop acting like a d1ck*ead and fix this group chat. I hope everyone had a good weekend.
- `hi` p=0.423 (hate): अगली मीटिंग में इस पर बात करते हैं। उस समुदाय के लोग इंसान कहलाने लायक नहीं।
- `gu-Latn` p=0.333 (harassment): Aavti meeting ma aa vishe vaat kariye. Sambhal, group chhodi de, badha tarathi pareshan che. Badhano weekend saro gayo hase.
- `hi` p=0.344 (hate): सबका सप्ताहांत अच्छा रहा होगा। अगली मीटिंग में इस पर बात करते हैं। ये बाहर वाले इंसान कहलाने लायक नहीं। अगली मीटिंग में इस पर बात करते हैं।
- `gu` p=0.428 (insult): આવતી મીટિંગમાં આ વિશે વાત કરીએ. બધાનો સપ્તાહાંત સારો ગયો હશે. તું સાવ ભોસડીના છે, ઓર્ડર બગાડી નાખ્યું.
- `hi` p=0.383 (threat): सबका सप्ताहांत अच्छा रहा होगा। अगली मीटिंग में इस पर बात करते हैं। एक और कमेंट किया तो हाथ पैर तोड़ दूंगा। अगली मीटिंग में इस पर बात करते हैं।
- `en` p=0.381 (harassment): The weather has been great lately. Thanks for sharing your thoughts. Everyone agrees, you should just disappear.

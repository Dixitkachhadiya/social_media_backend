"""
Integration tests for the REAL local model through the FastAPI service (no mocks, no external APIs).

    cd Backend/ai-moderation
    .venv/Scripts/python -m unittest discover -s tests -v

Assertions focus on behaviour the word list makes reliable (listed abusive words, threats) plus a few
clean sentences; model-only borderline cases are covered by evaluation/report.md instead.
"""
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.pop("MODERATION_SERVICE_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from inference.service import app  # noqa: E402

BLOCKED = [
    ("vulgar English", "This fucking traffic made me late again.", "VULGAR"),
    ("personal abuse English", "You are such a moron, you ruined the whole project.", "PERSONAL_ABUSE"),
    ("Hindi (Devanagari)", "तू एकदम चूतिया है, सब खराब कर दिया।", "PERSONAL_ABUSE"),
    ("Gujarati (script)", "તું સાવ નાલાયક છે, કામ બગાડી નાખ્યું.", "PERSONAL_ABUSE"),
    ("Hinglish", "Bro tu literally chutiya hai, pura plan kharab kar diya", "PERSONAL_ABUSE"),
    ("Hindi romanized threat", "Kal college ke bahar mil, jaan se maar dunga", "THREAT"),
    ("Gujarati romanized", "Tu sav nalayak che, project bagadi nakhyu", "PERSONAL_ABUSE"),
    ("mixed language", "Dude this report is late again, tu ekdum chutiya hai yaar", "PERSONAL_ABUSE"),
    ("harassment", "Nobody would miss you, just go kill yourself.", "HARASSMENT"),
    ("threat English", "If you post that again I will kill you.", "THREAT"),
    ("mild profanity", "Damn, the meeting got postponed again.", "MILD_PROFANITY"),
    ("obfuscated", "shut up you b1tchhhh, nobody asked", "PERSONAL_ABUSE"),
]

CLEAN = [
    "Had a great time at the conference today, learned a lot!",
    "The service at this restaurant was slow and the food was cold.",
    "Ye movie bakwas thi, paise barbaad ho gaye.",
    "Chhod do yaar, kal dekhenge.",
    "આજે ખૂબ ગરમી છે, બહાર જવું મુશ્કેલ છે.",
]


class ServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.client.__enter__()  # runs the lifespan (loads the model)

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def moderate(self, text):
        res = self.client.post("/moderate", json={"text": text})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_health(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "ok")

    def test_blocked_examples(self):
        for name, text, category in BLOCKED:
            with self.subTest(name):
                r = self.moderate(text)
                self.assertEqual(r["decision"], "block", r)
                self.assertTrue(r["blocked"])
                self.assertIs(r["is_toxic"], True)
                self.assertEqual(r["category"], category, r)
                self.assertTrue(r["flagged_terms"], r)
                for f in r["flagged_terms"]:
                    self.assertEqual(text[f["start"]:f["end"]], f["text"])  # BMP-only texts: UTF-16 == code points

    def test_clean_examples(self):
        for text in CLEAN:
            with self.subTest(text):
                r = self.moderate(text)
                self.assertEqual(r["decision"], "allow", r)
                self.assertEqual(r["category"], "CLEAN")
                self.assertFalse(r["flagged_terms"])

    def test_language_detection(self):
        self.assertEqual(self.moderate("तू एकदम चूतिया है")["language_code"], "hi")
        self.assertEqual(self.moderate("તું સાવ નાલાયક છે")["language_code"], "gu")
        self.assertEqual(self.moderate("Had a great time at the conference today")["language_code"], "en")

    def test_highlight_offsets_are_utf16(self):
        text = "😀😀 you are a b1tch"
        r = self.moderate(text)
        f = r["flagged_terms"][0]
        # JavaScript string indices: each emoji counts as 2 UTF-16 units
        self.assertEqual((f["start"], f["end"]), (15, 20))

    def test_input_validation(self):
        self.assertEqual(self.client.post("/moderate", json={"text": ""}).status_code, 422)
        self.assertEqual(self.client.post("/moderate", json={"text": "x" * 10001}).status_code, 422)
        self.assertEqual(self.client.post("/moderate", json={}).status_code, 422)

    def test_service_key(self):
        os.environ["MODERATION_SERVICE_KEY"] = "secret-test-key"
        try:
            self.assertEqual(self.client.post("/moderate", json={"text": "hello there"}).status_code, 401)
            ok = self.client.post("/moderate", json={"text": "hello there"}, headers={"X-Moderation-Key": "secret-test-key"})
            self.assertEqual(ok.status_code, 200)
        finally:
            os.environ.pop("MODERATION_SERVICE_KEY", None)

    def test_no_docs_exposed(self):
        self.assertEqual(self.client.get("/docs").status_code, 404)
        self.assertEqual(self.client.get("/openapi.json").status_code, 404)


if __name__ == "__main__":
    unittest.main()

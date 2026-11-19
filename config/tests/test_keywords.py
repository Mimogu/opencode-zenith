#!/usr/bin/env python3
"""Keyword engine: behaviour, and parity between keywords.mjs and lib/agy_keywords.py.
    python3 tests/test_keywords.py"""
import json
import os
import subprocess
import sys
import unittest

CFG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CFG, "lib"))
import agy_keywords as K  # noqa: E402

SAMPLES = [
    "running debugging databases caches cache images studies study fixed configured configure",
    "The memory retreival is kind of dumb, really — can you look at it?",
    "use super+tab instead of alt+tab; node.js and c++ on port 11434",
    "opencode-sentinel crashed after I'd updated the UI and DB settings",
    "Don't make the per-category rankings worse, it's installing stuff",
]


def js_tokenize(texts):
    code = ("import {tokenize} from './plugins/context-engine/keywords.mjs';"
            "const t = JSON.parse(await Bun.stdin.text()); console.log(JSON.stringify(t.map(tokenize)));")
    out = subprocess.run(["bun", "-e", code], cwd=CFG, input=json.dumps(texts), capture_output=True, text=True, timeout=30)
    return json.loads(out.stdout)


class Tokenizer(unittest.TestCase):
    def test_word_forms_share_a_key(self):
        for a, b in [("running", "run"), ("debugging", "debug"), ("caches", "cache"), ("studies", "study"),
                     ("configured", "configure"), ("fixes", "fixed"), ("installing", "install"), ("games", "gaming")]:
            self.assertEqual(K.stem(a), K.stem(b), (a, b))

    def test_filler_is_not_evidence(self):
        self.assertEqual(K.tokenize("can you tell me what you think, it's kind of really good"), [])

    def test_short_terms_and_symbols_survive(self):
        toks = K.tokenize("the ui and db in c++ with super+tab")
        for t in ("ui", "db", "c++", "super+tab"):
            self.assertIn(t, toks)

    def test_parity_with_js(self):
        self.assertEqual(js_tokenize(SAMPLES), [K.tokenize(s) for s in SAMPLES])


class Search(unittest.TestCase):
    idx = K.KeywordIndex([
        (1, "OmniRoute gateway listens on port 20128"),
        (2, "Images are generated with the flux model at 1024x1024"),
        (3, "Memory retrieval uses embeddinggemma through Ollama"),
        (4, "Configuration of the labwc compositor and keybindings"),
    ])

    def ids(self, q):
        return [h["id"] for h in self.idx.search(q)]

    def test_typo_and_word_family(self):
        self.assertEqual(self.ids("memory retreival")[0], 3)       # transposed letters
        self.assertEqual(self.ids("labwc configure")[0], 4)        # configure ~ configuration

    def test_synonym(self):
        self.assertEqual(self.ids("which proxy port")[0], 1)       # proxy ~ gateway

    def test_cover_reflects_how_much_is_explained(self):
        full = self.idx.search("omniroute gateway port")[0]
        part = self.idx.search("omniroute weather forecast")[0]
        self.assertGreater(full["cover"], 0.9)
        self.assertLess(part["cover"], 0.5)


if __name__ == "__main__":
    unittest.main()

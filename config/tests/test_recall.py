#!/usr/bin/env python3
"""Offline tests for lib/agy_recall.py: python3 tests/test_recall.py"""
import json
import os
import sqlite3
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lib"))
os.environ["OLLAMA_HOST"] = "127.0.0.1:9"  # no embeddings: exercise the keyword paths
import agy_recall as r  # noqa: E402


def source_db() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE session_message (session_id TEXT, type TEXT, seq INTEGER, data TEXT)")
    return con


def add(con, sid, seq, typ, data):
    con.execute("INSERT INTO session_message VALUES (?,?,?,?)", (sid, typ, seq, json.dumps(data)))


class RedactTest(unittest.TestCase):
    def test_credentials_are_redacted(self):
        text = ('export FAL_KEY="fal_sk_00000000fakefake0000000000000000:fakefakefakefake0000000000000000" '
                "hf_FAKEfakeFAKEfakeFAKEfake0123456789 sk-abcdefghijklmnopqrstuv AKIAABCDEFGHIJKLMNOP "
                "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 token: Zx9QwErTy7UiOp3AsDfGh5JkLz8XcVbN")
        out = r.redact(text)
        for leaked in ("fal_sk_0000", "hf_FAKE", "sk-abcdef", "AKIAABCD", "abcdefghijklmnopqrstuvwxyz123456", "Zx9QwErTy7"):
            self.assertNotIn(leaked, out)
        self.assertIn("FAL_KEY=[REDACTED]", out)

    def test_non_secrets_survive(self):
        text = ("/home/user/.config/opencode/plugins/context-engine/index.js commit 8b579d4 "
                "sha 9454ad1b9489daa57ab0a9f4ebe2faaf4dc82b8a0f26c9e5135151abd7c9378d ses_e5f854df2ffehYb2YU5sVWmlJr")
        self.assertEqual(r.redact(text), text)


class GistTest(unittest.TestCase):
    def test_real_session_with_summary(self):
        con = source_db()
        self.addCleanup(con.close)
        add(con, "s", 1, "user", {"text": "Fix the waybar volume module, it stopped showing percent"})
        add(con, "s", 2, "compaction", {"summary": "## Objective\n- fixed waybar; key=sk-abcdefghijklmnopqrstuv"})
        gist = r.build_gist(con, "s", "Waybar volume fix")
        self.assertIn("Summary:", gist)
        self.assertNotIn("sk-abcdef", gist)

    def test_probes_are_skipped(self):
        con = source_db()
        self.addCleanup(con.close)
        add(con, "a", 1, "user", {"text": "say OK in 1 word"})
        for i in range(5):
            add(con, "a", i + 2, "assistant", {"content": [{"type": "text", "text": "OK"}]})
        self.assertIsNone(r.build_gist(con, "a", "Single-word test"))      # tiny request, no summary
        add(con, "b", 1, "user", {"text": "Investigate why my laptop shuts down when the charger is unplugged"})
        add(con, "b", 2, "assistant", {"content": [{"type": "text", "text": "Looking."}]})
        self.assertIsNone(r.build_gist(con, "b", "Laptop shutdown"))        # under 4 assistant steps
        self.assertIsNone(r.build_gist(con, "b", ""))                       # untitled = bench/probe run
        add(con, "c", 1, "user", {"text": "Reply with exactly: OK, nothing else please thanks"})
        add(con, "c", 2, "compaction", {"summary": "  "})
        self.assertIsNone(r.build_gist(con, "c", "x"))                      # empty summary counts as none

    def test_long_single_request_task_is_kept(self):
        con = source_db()
        self.addCleanup(con.close)
        add(con, "d", 1, "user", {"text": "Investigate why my laptop shuts down when the charger is unplugged"})
        for i in range(5):
            add(con, "d", i + 2, "assistant", {"content": [{"type": "text", "text": f"step {i}: checked upower logs"}]})
        gist = r.build_gist(con, "d", "Laptop shutdown on unplug")
        self.assertIn("Outcome: step 4", gist)


class SearchTest(unittest.TestCase):
    def test_keyword_fallback_needs_query_coverage(self):
        con = sqlite3.connect(":memory:")
        self.addCleanup(con.close)
        con.executescript("""
            CREATE TABLE facts (id INTEGER PRIMARY KEY, domain TEXT, title TEXT, content TEXT, origin TEXT,
              verified INT, superseded_by INT, deleted INT DEFAULT 0, access_count INT DEFAULT 0);
            CREATE VIRTUAL TABLE facts_fts USING fts5(title, content, domain, content='facts', content_rowid='id');
            CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
              INSERT INTO facts_fts(rowid, title, content, domain) VALUES (new.id, new.title, new.content, new.domain); END;
            INSERT INTO facts(id, domain, title, content) VALUES (1, 'general', 'omniroute gateway', 'port 20128 on localhost');
        """)
        self.assertEqual([f["id"] for f in r.hybrid_facts(con, "omniroute gateway port")], [1])
        self.assertEqual(r.hybrid_facts(con, "omniroute weather forecast"), [])


if __name__ == "__main__":
    unittest.main()

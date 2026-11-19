#!/usr/bin/env python3
"""python3 tests/test_doc_audit.py: bin/doc-audit traces a document's figures to the data.

Cases come from the 2026-11-10 report: invented figures ("129.9%", cost/ton "1.0525"), figures
that trace only through a scale or a ratio, a report that "traced" to its own generator script,
and invented document metadata."""
import json, os, subprocess, sys, tempfile, unittest, zipfile

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "doc-audit")


def audit(doc, sources, extra=()):
    cmd = [sys.executable, TOOL, doc, "--sources", *sources, "--json", "--max", "50"]
    if extra:
        cmd += ["--extra", *extra]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout)


def untraced(res):
    return {u["figure"] for u in res["untraced_figures"]}


class DocAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        self.data = os.path.join(d, "work")
        os.makedirs(self.data)
        with open(os.path.join(self.data, "kpi.csv"), "w") as f:
            f.write("Year,Food Inflation,Import USD,Import EGP,Cost per ton\n"
                    "2020,-0.0015,1029647906.56,16226399402.79,1.0573\n"
                    "2023,0.6357,2346862385.44,71875978308.80,1.0183\n"
                    "2024,0.3382,2631399289.43,119200440575.84,0.9864\n")
        with open(os.path.join(self.data, "partners.csv"), "w") as f:
            f.write("partner,qty\nBrazil,2257252624.824\n")
        with open(os.path.join(self.data, "measures.txt"), "w") as f:
            f.write("Monthly Income EGP = DIVIDE(AVERAGE('income per capita'[Value]), 12, 0)\n")

    def tearDown(self):
        self.tmp.cleanup()

    def md(self, name, text):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w") as f:
            f.write(text)
        return p

    def test_scales_and_rounding_trace(self):
        doc = self.md("r.md", "Food inflation hit 63.57% in 2023. Brazil supplied 2.257bn units.\n"
                              "The EGP import bill reached 119.20bn in 2024 (USD 2.63bn).\n")
        res = audit(doc, [self.data])
        self.assertEqual(res["untraced_total"], 0, res["untraced_figures"])
        self.assertGreaterEqual(res["source"], 4)

    def test_invented_figures_are_untraced(self):
        doc = self.md("r.md", "Cost per ton fell from $1.0525 (2020) to $0.9803 (2024).\n"
                              "A 129.9% Max Import Volume card shows the rollup.\n")
        self.assertEqual(untraced(audit(doc, [self.data])), {"$1.0525", "$0.9803", "129.9%"})

    def test_derived_from_the_same_row_or_paragraph(self):
        doc = self.md("r.md", "| 2020 | 16.23bn | 2024 | 119.20bn | 7.35× |\n"
                              "USD rose from 1.03bn to 2.63bn, a 2.56× increase.\n")
        self.assertEqual(audit(doc, [self.data])["untraced_total"], 0)

    def test_computations_count_but_the_document_echoed_back_does_not(self):
        doc = self.md("r.md", "The twelve-product average fell 34.58% in 2023, and erosion was 22.57% in 2024.\n")
        # a pdftotext of the report itself is not a computation
        echo = self.md("echo.txt", "The twelve-product average fell 34.58% in 2023, and erosion was 22.57% in 2024.\n")
        self.assertEqual(untraced(audit(doc, [self.data], [echo])), {"34.58%", "22.57%"})
        comp = self.md("comp.txt", "2023 mean affordability -0.3458\nerosion 2024 0.2257\n")
        self.assertEqual(audit(doc, [self.data], [comp])["untraced_total"], 0)

    def test_headings_years_references_and_counts_are_not_audited(self):
        doc = self.md("r.md", "11.1 Fiscal hedge on imports\nSee (11.1) and Table 3.1, Figure 6.2.\n"
                              "In 2023 there were 9 critical items on 2026-11-10 at 05:34.\n")
        self.assertEqual(audit(doc, [self.data])["audited"], 0)

    def test_invented_metadata_is_flagged_but_ordinary_words_are_not(self):
        doc = self.md("r.md", "Revision history\nv0.7 Sep 2026 draft\nClassification: Confidential\n"
                              "4.3 Risk classification\nThe signed average of the premiums.\n")
        meta = " | ".join(audit(doc, [self.data])["metadata_not_in_sources"])
        self.assertIn("Revision history", meta)
        self.assertIn("Confidential", meta)
        self.assertNotIn("Risk classification", meta)
        self.assertNotIn("signed", meta)

    def test_docx_table_rows_and_name_stem_exclusion(self):
        doc = os.path.join(self.tmp.name, "report.docx")
        row = ("<w:tr><w:tc><w:p><w:r><w:t>2024</w:t></w:r></w:p></w:tc>"
               "<w:tc><w:p><w:r><w:t>16.23</w:t></w:r></w:p></w:tc>"
               "<w:tc><w:p><w:r><w:t>119.20</w:t></w:r></w:p></w:tc>"
               "<w:tc><w:p><w:r><w:t>7.35×</w:t></w:r></w:p></w:tc></w:tr>")
        body = f"<w:document><w:body><w:p><w:r><w:t>Cost per ton was 1.0525.</w:t></w:r></w:p><w:tbl>{row}</w:tbl></w:body></w:document>"
        with zipfile.ZipFile(doc, "w") as z:
            z.writestr("word/document.xml", body)
        # a draft of the same report in the data folder must not trace the report to itself
        with open(os.path.join(self.data, "report.md"), "w") as f:
            f.write("Cost per ton was 1.0525.")
        res = audit(doc, [self.data])
        self.assertEqual(untraced(res), {"1.0525"})


if __name__ == "__main__":
    unittest.main(verbosity=1)

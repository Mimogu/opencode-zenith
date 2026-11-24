import { test, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { parseEnv, collectSecrets, redactSecrets } from "../plugins/context-engine/secrets.mjs";

const HF = "hf_ExampleExampleExample1234567890ab";
const OR = "sk-or-v1-0123456789abcdef0123456789abcdef";

function envFile() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sec-"));
  const f = path.join(d, "free-models.env");
  fs.writeFileSync(f, `# keys\nexport OPENROUTER_API_KEY="${OR}"\nHF_TOKEN=${HF}  # comment\nGRAPHIFY_HOME=/home/u/graphify\nDEBUG=1\nSHORT=abc\n`);
  return f;
}

test("parses env lines with export, quotes and comments", () => {
  const m = parseEnv(`export A="x y"\nB=z # c\n# C=no\n`);
  expect(m.get("A")).toBe("x y");
  expect(m.get("B")).toBe("z");
  expect(m.has("C")).toBe(false);
});

test("collects key values, skips paths, numbers and short values", () => {
  const s = collectSecrets({ files: [envFile()], env: { MY_TOKEN: "tok_abcdefghijklmnop", PATH: "/usr/bin:/bin", HOME: "/home/u" } });
  const names = s.map(([, n]) => n).sort();
  expect(names).toEqual(["HF_TOKEN", "MY_TOKEN", "OPENROUTER_API_KEY"]);
});

test("redacts tool results, tool inputs and assistant text, not user text", () => {
  const secrets = collectSecrets({ files: [envFile()], env: {} });
  const messages = [
    { role: "user", content: [{ type: "text", text: `my key is ${HF}` }] },
    { role: "assistant", content: [
      { type: "text", text: `using ${OR}` },
      { type: "tool-call", id: "c1", name: "shell", input: { command: `curl -H 'Authorization: Bearer ${OR}' x` } },
    ] },
    { role: "tool", content: [{ type: "tool-result", id: "c1", name: "shell", result: { type: "text", value: `OPENROUTER_API_KEY=${OR}\nHF_TOKEN=${HF}` } }] },
  ];
  const before = JSON.stringify(messages);
  const r = redactSecrets(messages, secrets);
  expect(JSON.stringify(messages)).toBe(before); // never edited in place
  expect(r.redacted).toBe(4);
  const sent = JSON.stringify(r.messages.slice(1));
  expect(sent).not.toContain(OR);
  expect(sent).not.toContain(HF);
  expect(sent).toContain("<redacted:OPENROUTER_API_KEY>");
  expect(sent).toContain("<redacted:HF_TOKEN>");
  expect(r.messages[0]).toBe(messages[0]);
});

test("error results and content arrays are covered; clean messages keep identity", () => {
  const secrets = [[HF, "HF_TOKEN"]];
  const err = { role: "tool", content: [{ type: "tool-result", id: "e", result: { type: "error", value: { error: { message: `401 for ${HF}` } } } }] };
  const arr = { role: "tool", content: [{ type: "tool-result", id: "a", result: { type: "content", value: [{ type: "text", text: HF }, { type: "image", data: "x" }] } }] };
  const clean = { role: "tool", content: [{ type: "tool-result", id: "c", result: { type: "text", value: "ok" } }] };
  const r = redactSecrets([err, arr, clean], secrets);
  expect(r.redacted).toBe(2);
  expect(JSON.stringify(r.messages)).not.toContain(HF);
  expect(r.messages[1].content[0].result.value.some((x) => x.type === "image")).toBe(true);
  expect(r.messages[2]).toBe(clean);
  expect(redactSecrets([clean], secrets).messages[0]).toBe(clean);
});

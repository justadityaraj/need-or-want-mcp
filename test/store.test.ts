import { strict as assert } from "node:assert";
import { appendFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";

const fresh = () => new Store(mkdtempSync(join(tmpdir(), "need-or-want-")));

test("JSON files round-trip and leave no temp file", () => {
  const s = fresh();
  assert.deepEqual(s.readJson("state.json", { a: 0 }), { a: 0 });
  s.writeJson("state.json", { a: 1 });
  assert.deepEqual(s.readJson("state.json", {}), { a: 1 });
  assert.equal(existsSync(join(s.dir, "state.json.tmp")), false);
});

test("logs are append-only and skip corrupt lines without failing", () => {
  const s = fresh();
  s.append("decisions.jsonl", { n: 1 });
  appendFileSync(join(s.dir, "decisions.jsonl"), "{not json\n");
  s.append("decisions.jsonl", { n: 2 });
  assert.deepEqual(s.readLines("decisions.jsonl"), { items: [{ n: 1 }, { n: 2 }], skipped: 1 });
  assert.deepEqual(s.readLines("missing.jsonl"), { items: [], skipped: 0 });
});

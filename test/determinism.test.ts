import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../src/engine/score.js";
import { args } from "./fixtures.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));
const ALLOWED = [/^\.\.?\//, /^node:(fs|path|os|crypto)$/, /^@modelcontextprotocol\/sdk\//, /^zod$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

const imports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

test("source imports nothing that can reach the network", () => {
  for (const f of files(SRC)) {
    for (const m of imports(f)) assert.ok(ALLOWED.some((r) => r.test(m)), `${f} imports ${m}`);
    assert.ok(!/\bfetch\s*\(/.test(readFileSync(f, "utf8")), `${f} calls fetch`);
  }
});

test("the engine imports only itself", () => {
  for (const f of files(join(SRC, "engine"))) for (const m of imports(f)) assert.ok(m.startsWith("./"), `${f} imports ${m}`);
});

test("the engine never reads the clock or randomness", () => {
  for (const f of files(join(SRC, "engine"))) {
    assert.ok(!/Date\.now\(|new Date\(\)|Math\.random|randomUUID/.test(readFileSync(f, "utf8")), f);
  }
});

test("the same inputs give the same decision, even after a JSON round trip", () => {
  const a = args();
  const copy = {
    ...JSON.parse(JSON.stringify({ input: a.input, answers: a.answers, cfg: a.cfg, history: a.history })),
    now: new Date(a.now.getTime()),
  };
  assert.deepEqual(decide(a), decide(a));
  assert.deepEqual(decide(a), decide(copy));
});

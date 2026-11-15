import { createHash } from "node:crypto";
import { z } from "zod";
import { DEFAULT_CONFIG } from "./engine/defaults.js";
import { CATEGORIES, type CardPolicy, type Config } from "./engine/types.js";
import { DAY } from "./engine/util.js";

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => typeof x === "object" && x !== null && !Array.isArray(x);

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge((base as Json)[k], v) : v;
  return out as T;
}

export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(",")}]`;
  if (isObj(x)) {
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

export const configHash = (c: Config): string => createHash("sha256").update(stableStringify(c)).digest("hex").slice(0, 16);

const share = z.number().min(0);
const schema = z.object({
  currency: z.string().min(1),
  budget: z.object({
    monthly: z.number().nonnegative(),
    schedule: z.record(z.string().regex(/^\d{4}-\d{2}$/), z.number().nonnegative()),
  }),
  vetoes: z.object({
    debt: z.boolean(),
    creditCard: z.union([z.literal("allow"), z.literal("block"), z.object({ onlyMerchants: z.array(z.string()) })]),
    blockedCategories: z.array(z.object({ category: z.enum(CATEGORIES), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })),
  }),
  oneOffs: z.object({ mode: z.enum(["count", "cap"]), yearlyCap: z.number().nonnegative() }),
  weights: z
    .object({ need: share, budget: share, costPerUse: share, history: share, deal: share })
    .refine((w) => Math.abs(w.need + w.budget + w.costPerUse + w.history + w.deal - 1) < 1e-6, "weights must add up to 1"),
  thresholds: z
    .object({ buy: z.number().min(0).max(100), wait: z.number().min(0).max(100) })
    .refine((t) => t.wait <= t.buy, "thresholds.wait must not be above thresholds.buy"),
  waitBands: z.array(z.object({ upTo: z.number().positive().nullable(), hours: z.number().nonnegative() })).min(1),
  realReturn: z.number().min(-0.5).max(0.5),
  hourlyIncome: z.number().positive().nullable(),
  loosenDelayDays: z.number().int().min(0),
  categories: z.record(z.string(), z.object({ lifespanMonths: z.number().positive().nullable(), lambda: z.number().min(0) })),
});

export function loadConfig(raw: unknown): Config {
  return schema.parse(deepMerge(DEFAULT_CONFIG, raw)) as Config;
}

const cardRank = (p: CardPolicy): number => (p === "block" ? 0 : p === "allow" ? 2 : 1);

function cardTighter(old: CardPolicy, next: CardPolicy): boolean {
  if (cardRank(next) !== cardRank(old)) return cardRank(next) < cardRank(old);
  if (typeof old === "string" || typeof next === "string") return true;
  return next.onlyMerchants.every((m) => old.onlyMerchants.includes(m));
}

export function isTightening(old: Config, next: Config): boolean {
  const months = new Set([...Object.keys(old.budget.schedule), ...Object.keys(next.budget.schedule)]);
  const budgetOk =
    next.budget.monthly <= old.budget.monthly &&
    [...months].every((k) => (next.budget.schedule[k] ?? next.budget.monthly) <= (old.budget.schedule[k] ?? old.budget.monthly));
  const blocksOk = old.vetoes.blockedCategories.every((b) =>
    next.vetoes.blockedCategories.some((n) => n.category === b.category && n.until >= b.until),
  );
  const oneOffOk = next.oneOffs.mode === "count" || (old.oneOffs.mode === "cap" && next.oneOffs.yearlyCap <= old.oneOffs.yearlyCap);
  const bandsOk =
    next.waitBands.length === old.waitBands.length &&
    next.waitBands.every((b, i) => b.upTo === old.waitBands[i].upTo && b.hours >= old.waitBands[i].hours);
  const fixed = (c: Config) => stableStringify([c.weights, c.categories, c.realReturn, c.hourlyIncome, c.currency]);
  return (
    budgetOk &&
    (next.vetoes.debt || !old.vetoes.debt) &&
    cardTighter(old.vetoes.creditCard, next.vetoes.creditCard) &&
    blocksOk &&
    oneOffOk &&
    bandsOk &&
    next.thresholds.buy >= old.thresholds.buy &&
    next.thresholds.wait >= old.thresholds.wait &&
    next.loosenDelayDays >= old.loosenDelayDays &&
    fixed(next) === fixed(old)
  );
}

export interface ConfigState {
  applied: Config | null;
  pending: { config: Config; since: string } | null;
}

// ponytail: a change that mixes tightening and loosening waits as a whole; split it per field if that ever annoys anyone
export function resolveConfig(file: Config, st: ConfigState, now: Date): { inForce: Config; state: ConfigState } {
  const applyNow = { inForce: file, state: { applied: file, pending: null } };
  if (st.applied === null) return applyNow;
  const same = (a: Config, b: Config) => stableStringify(a) === stableStringify(b);
  if (same(file, st.applied) || isTightening(st.applied, file)) return applyNow;
  const pending = st.pending && same(st.pending.config, file) ? st.pending : { config: file, since: now.toISOString() };
  if (now.getTime() - Date.parse(pending.since) >= st.applied.loosenDelayDays * DAY) return applyNow;
  return { inForce: st.applied, state: { applied: st.applied, pending } };
}

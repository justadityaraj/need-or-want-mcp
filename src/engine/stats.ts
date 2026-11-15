import { WORTH, index, latestReview } from "./history.js";
import type { LogEvent } from "./types.js";
import { DAY, round2, round4 } from "./util.js";

export interface DueReview {
  id: string;
  item: string;
  day: 30 | 90;
  kind: "bought" | "skipped";
}

export interface Accuracy {
  reviewed: number;
  brier: number | null;
  skill: number | null;
  followed: number;
  followedWorth: number | null;
  overrides: number;
  overrideWorth: number | null;
  skippedReviewed: number;
  falseSkip: number | null;
  moneyNotSpent: number;
  suggestions: string[];
}

export function reviewsDue(events: LogEvent[], now: Date): DueReview[] {
  const ix = index(events);
  const due: DueReview[] = [];
  for (const [id, v] of ix.verdicts) {
    const done = new Set((ix.reviews.get(id) ?? []).map((r) => r.day));
    const o = ix.outcomes.get(id);
    if (o?.bought) {
      for (const day of [30, 90] as const) {
        if (!done.has(day) && now.getTime() - Date.parse(o.ts) >= day * DAY) due.push({ id, item: v.input.item, day, kind: "bought" });
      }
    } else if (ix.latest.get(id)?.decision.verdict !== "BUY" && !done.has(30) && now.getTime() - Date.parse(v.ts) >= 30 * DAY) {
      due.push({ id, item: v.input.item, day: 30, kind: "skipped" });
    }
  }
  return due;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function accuracy(events: LogEvent[]): Accuracy {
  const ix = index(events);
  const pairs: { p: number; o: number; override: boolean }[] = [];
  let missYes = 0;
  let missN = 0;
  let notSpent = 0;
  for (const [id] of ix.verdicts) {
    const latest = ix.latest.get(id);
    if (!latest) continue;
    const o = ix.outcomes.get(id);
    const r = latestReview(ix.reviews.get(id));
    if (o?.bought && r?.worthIt) pairs.push({ p: latest.decision.score / 100, o: WORTH[r.worthIt], override: o.override });
    if (!o?.bought && latest.decision.verdict !== "BUY") {
      const miss = (ix.reviews.get(id) ?? []).find((x) => x.missIt);
      if (miss) {
        missN++;
        if (miss.missIt === "yes") missYes++;
      }
      if ((o && !o.bought) || miss) notSpent += latest.decision.cost;
    }
  }
  const brier = mean(pairs.map((x) => (x.p - x.o) ** 2));
  const base = mean(pairs.map((x) => x.o));
  const ref = base === null ? null : mean(pairs.map((x) => (base - x.o) ** 2));
  const enough = pairs.length >= 10;
  const followed = pairs.filter((x) => !x.override);
  const overrides = pairs.filter((x) => x.override);
  const overrideRate = mean(overrides.map((x) => x.o)) ?? 0;
  const suggestions: string[] = [];
  if (overrides.length >= 10 && overrideRate >= 0.7) {
    suggestions.push("Your overrides were judged worth it at least 70% of the time. Consider lowering thresholds.buy by 5.");
  }
  if (missN >= 10 && missYes / missN > 0.3) {
    suggestions.push("You still missed more than 30% of the items you skipped. Consider lowering thresholds.wait by 5.");
  }
  return {
    reviewed: pairs.length,
    brier: enough && brier !== null ? round4(brier) : null,
    skill: enough && brier !== null && ref ? round4(1 - brier / ref) : null,
    followed: followed.length,
    followedWorth: followed.length >= 5 ? mean(followed.map((x) => x.o)) : null,
    overrides: overrides.length,
    overrideWorth: overrides.length >= 5 ? mean(overrides.map((x) => x.o)) : null,
    skippedReviewed: missN,
    falseSkip: missN >= 5 ? missYes / missN : null,
    moneyNotSpent: round2(notSpent),
    suggestions,
  };
}

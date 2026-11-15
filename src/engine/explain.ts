import { NEED_IDS, QUESTIONS, option } from "./questions.js";
import { decide, type DecideArgs } from "./score.js";
import type { Answers, Config, Decision, Veto } from "./types.js";
import { localTime, round2 } from "./util.js";

type FactId = (typeof NEED_IDS)[number];

export interface Change {
  changes: Partial<Record<FactId, string>>;
  score: number;
}

export interface WhatWouldChange {
  nextBand: Change | null;
  toBuy: Change | null;
}

const band = (score: number, cfg: Config): number => (score >= cfg.thresholds.buy ? 2 : score >= cfg.thresholds.wait ? 1 : 0);

export function whatWouldChange(args: DecideArgs, current: number): WhatWouldChange {
  const ids = NEED_IDS.filter((id) => args.answers[id] !== undefined);
  const from = band(current, args.cfg);
  const best: WhatWouldChange = { nextBand: null, toBuy: null };
  const better = (n: number, s: number, c: Change | null): boolean =>
    c === null || n < Object.keys(c.changes).length || (n === Object.keys(c.changes).length && s > c.score);
  const visit = (i: number, picked: Partial<Record<FactId, string>>): void => {
    if (i < ids.length) {
      for (const o of QUESTIONS[ids[i]].options ?? []) visit(i + 1, { ...picked, [ids[i]]: o.key });
      return;
    }
    const changes = Object.fromEntries(
      Object.entries(picked).filter(([id, key]) => args.answers[id as FactId] !== key),
    ) as Partial<Record<FactId, string>>;
    const n = Object.keys(changes).length;
    if (n === 0) return;
    const s = decide({ ...args, answers: { ...args.answers, ...picked } as Answers }).score;
    const b = band(s, args.cfg);
    if (b > from && better(n, s, best.nextBand)) best.nextBand = { changes, score: s };
    if (b === 2 && from < 2 && better(n, s, best.toBuy)) best.toBuy = { changes, score: s };
  };
  visit(0, {});
  if (best.toBuy && best.nextBand && JSON.stringify(best.toBuy) === JSON.stringify(best.nextBand)) best.toBuy = null;
  return best;
}

export const ARGUMENT_REPLIES: Record<string, string> = {
  deserve:
    "Feeling you've earned it is a known bias, the licensing effect. It isn't a fact about this purchase, so the verdict stands.",
  scarcity:
    "\"Only a few left\" and countdown timers are pressure, not facts. Regulators class false urgency as a dark pattern. The verdict stands.",
  sale: "A discount against MRP or a list price is an anchor. Only this product's own price history counts here. The verdict stands.",
  one_time:
    "Every one-time purchase feels like an exception. People spend almost twice what they expect on them. Your one-off record is already in the score. The verdict stands.",
  social: "Other people owning it doesn't change what it does for you. The verdict stands.",
  mood: "The feeling is real, but it isn't a fact about this purchase. The verdict stands.",
  sunk: "Time already spent researching is gone either way. It doesn't make the purchase better. The verdict stands.",
  future_use:
    "How often you'll use it is an estimate. Change it with the U1 field: after a verdict a revised estimate counts at 50%, and only once.",
  other:
    "Which fact changed? Price, category, add-on cost, what's prompting it, what you own, what happens if you wait, a real deadline, money spent this month, or how you'll pay.",
};

export const STATUS_REPLIES = {
  repeat: "You've already made this exact point. Repeating it changes nothing. The verdict stands.",
  estimate_used: "This estimate was already revised once after the verdict. It can't be revised again. The verdict stands.",
} as const;

const VETO_TEXT: Record<Veto, string> = {
  blocked: "This category is blocked in your settings.",
  debt: "Only if paid in full. EMI, pay-later and new credit are never allowed.",
  card: "Not on a credit card here. Your card policy doesn't allow it for this merchant.",
  over_budget: "It costs more than what's left this month.",
  oneoff_cap: "Your yearly one-off cap is used up.",
};

const money = (x: number, currency: string): string => `${currency} ${Number.isInteger(x) ? x : x.toFixed(2)}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function componentLines(d: Decision, cfg: Config): string[] {
  const c = d.components;
  const n = d.numbers;
  const cur = cfg.currency;
  const lines: [number, number, string][] = [
    [cfg.weights.need, c.need, `Need score ${c.need} of 1, so this is a ${d.needLabel}.`],
    [
      cfg.weights.budget,
      c.budget,
      n.remaining > 0
        ? `It uses ${pct(n.cost / n.remaining)} of what's left this month (${money(n.remaining, cur)}).`
        : "Nothing is left in this month's budget.",
    ],
    [
      cfg.weights.costPerUse,
      c.costPerUse,
      n.costPerUse === null
        ? "Cost per use doesn't apply here or wasn't asked."
        : `About ${money(n.costPerUse, cur)} per use, after allowing for the usual overestimate of use.`,
    ],
    [cfg.weights.history, c.history, `Your record with similar purchases scores ${round2(c.history)} of 1.`],
    [
      cfg.weights.deal,
      c.deal,
      c.deal === 0.5
        ? "The price is at its usual level, or there's no price history yet."
        : c.deal > 0.5
          ? "The price is below its usual level."
          : "The price is above its usual level.",
    ],
  ];
  const weightOf = ([w, s]: [number, number, string]): number => (d.verdict === "BUY" ? w * s : w * (1 - s));
  return lines
    .sort((x, y) => weightOf(y) - weightOf(x))
    .slice(0, 2)
    .map((l) => l[2]);
}

function waitReason(d: Decision): string {
  if (d.vetoes.includes("over_budget")) return "it costs more than what's left, so it waits for next month's budget.";
  if (d.vetoes.includes("oneoff_cap")) return "your yearly one-off cap resets then.";
  if (d.marginal) return "the score is marginal (50 to 69), so the wait is twice the normal cooling-off for this price.";
  return "the normal cooling-off for this price.";
}

function describe(ch: Change): string {
  return Object.entries(ch.changes)
    .map(([id, key]) => `${QUESTIONS[id as FactId].text} → "${option(id as FactId, key)?.label}"`)
    .join(" and ");
}

export function render(d: Decision, cfg: Config, wwc: WhatWouldChange): string {
  if (d.verdict === "NOT_PERSONAL") return "This isn't a personal purchase. Check it against the business budget.";
  const n = d.numbers;
  const cur = cfg.currency;
  const until = localTime(n.waitUntil ?? new Date(0).toISOString());
  const label = `This is a ${d.needLabel} (score ${d.score}/100).`;
  const lines = [d.verdict === "WAIT" ? `WAIT until ${until}. ${label}` : `${d.verdict}. ${label}`];
  if (d.emergency) lines.push("Emergency: buy the cheapest option that fixes the problem.");
  if (d.marginal && d.verdict === "BUY") lines.push("Marginal: it passed because you still wanted it after the wait.");
  if (d.faded) lines.push("You no longer wanted it after the wait.");
  const figures = [`${money(n.cost, cur)} is ${n.budgetDays} days of your budget`];
  if (n.hoursOfWork !== null) figures.push(`${n.hoursOfWork} hours of work`);
  if (n.costPerUse !== null) figures.push(`${money(n.costPerUse, cur)} per use`);
  figures.push(`${money(n.fv10, cur)} in 10 years or ${money(n.fv20, cur)} in 20 if invested (today's money)`);
  figures.push(
    n.yearlyCommitment !== null ? `${money(n.yearlyCommitment, cur)} a year` : `${money(n.monthlyEquivalent, cur)} a month over its life`,
  );
  lines.push(figures.join(" · "));
  for (const v of d.vetoes) lines.push(VETO_TEXT[v]);
  if (d.verdict === "WAIT") lines.push(`Why this date: ${waitReason(d)}`);
  if (n.oneOffs90) {
    lines.push(
      n.oneOffs90.count === 0
        ? "This is your first one-time purchase in 90 days."
        : `One-time purchases in the last 90 days: ${n.oneOffs90.count} (${money(n.oneOffs90.total, cur)}). They count as a group, not as exceptions.`,
    );
  }
  lines.push(...componentLines(d, cfg));
  if (wwc.nextBand) lines.push(`What would change this: ${describe(wwc.nextBand)} (score ${wwc.nextBand.score}).`);
  if (wwc.toBuy) lines.push(`To reach BUY: ${describe(wwc.toBuy)} (score ${wwc.toBuy.score}).`);
  if (d.verdict === "WAIT") lines.push(`If you still want it on ${until}, check again.`);
  if (d.verdict !== "BUY") lines.push("You can still buy it. It will be logged as an override.");
  return lines.join("\n");
}

export function evaluate(args: DecideArgs): { decision: Decision; whatWouldChange: WhatWouldChange; message: string } {
  const decision = decide(args);
  const wwc = whatWouldChange(args, decision.score);
  return { decision, whatWouldChange: wwc, message: render(decision, args.cfg, wwc) };
}

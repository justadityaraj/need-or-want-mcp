import { optionValue, questionsFor, tierFor, type QuestionId } from "./questions.js";
import type {
  Answers,
  CardPolicy,
  Components,
  Config,
  Decision,
  History,
  NeedLabel,
  PricePoint,
  PurchaseInput,
  Verdict,
  Veto,
} from "./types.js";
import { DAY, HOUR, clamp, daysInMonth, isoDate, localDate, median, monthKey, round2, round4, startOfNextMonth } from "./util.js";

const NEED_WEIGHTS = { N1: 0.4, N2: 0.25, N3: 0.35 } as const;
const PRIOR_RHO = 0.5;
const PRIOR_REGRET = 0.3;
const SHRINK = 5;

export interface DecideArgs {
  input: PurchaseInput;
  answers: Answers;
  cfg: Config;
  history: History;
  now: Date;
}

export interface CostPerUse {
  score: number;
  cpu: number | null;
  uses: number | null;
  months: number | null;
}

export function needScore(a: Answers): { score: number; label: NeedLabel; emergency: boolean } {
  let total = 0;
  let weight = 0;
  for (const id of ["N1", "N2", "N3"] as const) {
    const v = optionValue(id, a[id]);
    if (v === undefined) continue;
    total += NEED_WEIGHTS[id] * v;
    weight += NEED_WEIGHTS[id];
  }
  const score = weight === 0 ? 0 : round4(total / weight);
  const label: NeedLabel = score >= 0.7 ? "NEED" : score >= 0.35 ? "MIXED" : "WANT";
  return { score, label, emergency: a.N1 === "a" && a.N3 === "a" };
}

export function monthBudget(cfg: Config, now: Date): number {
  return cfg.budget.schedule[monthKey(now)] ?? cfg.budget.monthly;
}

export function spentSoFar(input: PurchaseInput, a: Answers, h: History): number {
  return input.spentThisMonth ?? h.boughtThisMonth + (a.SP ?? h.spentElsewhere ?? 0);
}

export function costNow(input: PurchaseInput, a: Answers): number {
  return input.price + (a.U3 ?? 0);
}

export function budgetFit(cost: number, remaining: number): number {
  if (remaining <= 0) return 0;
  return clamp(1 - cost / remaining) ** 2;
}

export function realism(h: History): number {
  const observed = h.usage.n > 0 && h.usage.predicted > 0 ? h.usage.actual / h.usage.predicted : PRIOR_RHO;
  return clamp((h.usage.n * observed + SHRINK * PRIOR_RHO) / (h.usage.n + SHRINK), 0.2, 1);
}

export function effectiveUses(usesPerMonth: number, months: number, lambda: number, rho: number): number {
  if (lambda <= 0) return usesPerMonth * rho * months;
  return (usesPerMonth * rho * (1 - Math.exp(-lambda * months))) / lambda;
}

export function cpuScore(costPerUse: number, daily: number): number {
  const q = costPerUse / daily;
  if (q <= 0) return 1;
  return clamp(Math.log10(1 / q) / Math.log10(20));
}

export function monthlyPrice(input: PurchaseInput): number | null {
  if (input.recurring === "monthly") return input.price;
  if (input.recurring === "yearly") return input.price / 12;
  return null;
}

export function costPerUse(input: PurchaseInput, a: Answers, cfg: Config, h: History, daily: number): CostPerUse {
  const defaults = cfg.categories[input.category];
  if (defaults.lifespanMonths === null) return { score: 0.5, cpu: null, uses: null, months: null };
  const months = a.U2 ?? defaults.lifespanMonths;
  if (a.U1 === undefined) return { score: 0.5, cpu: null, uses: null, months };
  const uses = effectiveUses(a.U1, months, defaults.lambda, realism(h));
  if (uses <= 0) return { score: 0, cpu: null, uses: 0, months };
  const perMonth = monthlyPrice(input);
  const addOns = a.U3 ?? 0;
  const total =
    perMonth === null
      ? input.price + addOns + (input.runningCostPerMonth ?? 0) * months - (input.resaleValue ?? 0)
      : perMonth * months + addOns;
  const cpu = total / uses;
  return { score: cpuScore(cpu, daily), cpu, uses, months };
}

export function historyScore(a: Answers, h: History): number {
  const regret = (h.category.regret + SHRINK * PRIOR_REGRET) / (h.category.n + SHRINK);
  const pressure = a.O1 ? Math.min(h.oneOffs90.count / 5, 1) * 0.5 : 0;
  return (1 - regret) * (1 - pressure);
}

export function dealScore(price: number, prices: PricePoint[], now: Date): number {
  const recent = prices.filter((p) => now.getTime() - Date.parse(p.ts) <= 90 * DAY);
  if (recent.length < 3) return 0.5;
  const times = recent.map((p) => Date.parse(p.ts));
  if (Math.max(...times) - Math.min(...times) < 7 * DAY) return 0.5;
  const m = median(recent.map((p) => p.price));
  return clamp(0.5 + (m - price) / m / 0.4);
}

export function futureValue(input: PurchaseInput, a: Answers, r: number, years: number): number {
  const lump = (input.recurring === "none" ? input.price : 0) + (a.U3 ?? 0);
  const perMonth = monthlyPrice(input);
  const i = (1 + r) ** (1 / 12) - 1;
  const annuity = perMonth === null ? 0 : i === 0 ? perMonth * 12 * years : perMonth * (((1 + i) ** (12 * years) - 1) / i);
  return round2(lump * (1 + r) ** years + annuity);
}

export function lateNight(now: Date): boolean {
  const h = now.getHours();
  return h >= 23 || h < 5;
}

export function baseWaitHours(share: number, cfg: Config): number {
  const band = cfg.waitBands.find((b) => b.upTo === null || share < b.upTo) ?? cfg.waitBands[cfg.waitBands.length - 1];
  return band.hours;
}

export function waitHours(share: number, a: Answers, cfg: Config, now: Date): number {
  const base = baseWaitHours(share, cfg);
  if (a.N1 === "a") return Math.min(base, 24);
  const m = Math.min(2, (optionValue("S1", a.S1) ?? 1) * (optionValue("S2", a.S2) ?? 1) * (lateNight(now) ? 1.25 : 1));
  return Math.ceil(base * m);
}

export function capByDeadline(hours: number, a: Answers, now: Date): number {
  if (!a.N4 || a.N4 === "none") return hours;
  const left = (localDate(a.N4).getTime() - now.getTime()) / HOUR - 24;
  return Math.max(0, Math.min(hours, Math.floor(left)));
}

export function pendingQuestions(input: PurchaseInput, a: Answers, cfg: Config, h: History, now: Date): QuestionId[] {
  const share = costNow(input, a) / monthBudget(cfg, now);
  const ids = questionsFor(tierFor(share)).filter((id) => a[id] === undefined);
  if (input.spentThisMonth === undefined && h.spentElsewhere === null && a.SP === undefined) ids.push("SP");
  if (h.firstCheckTs !== null && a.STILL_WANT === undefined) ids.push("STILL_WANT");
  return ids;
}

export function scoreOf(c: Components, cfg: Config): number {
  const w = cfg.weights;
  return Math.round(100 * (w.need * c.need + w.budget * c.budget + w.costPerUse * c.costPerUse + w.history * c.history + w.deal * c.deal));
}

function cardAllowed(policy: CardPolicy, merchant: string | undefined): boolean {
  if (policy === "allow") return true;
  if (policy === "block") return false;
  return merchant !== undefined && policy.onlyMerchants.includes(merchant.toLowerCase());
}

const hoursBetween = (from: Date, to: Date): number => Math.ceil((to.getTime() - from.getTime()) / HOUR);

export function decide({ input, answers: a, cfg, history: h, now }: DecideArgs): Decision {
  const budget = monthBudget(cfg, now);
  const daily = budget / daysInMonth(now);
  const cost = costNow(input, a);
  const remaining = budget - spentSoFar(input, a, h);
  const need = needScore(a);
  const cpu = costPerUse(input, a, cfg, h, daily);
  const components: Components = {
    need: need.score,
    budget: budgetFit(cost, remaining),
    costPerUse: cpu.score,
    history: historyScore(a, h),
    deal: dealScore(input.price, h.prices, now),
  };
  const score = scoreOf(components, cfg);
  const perMonth = monthlyPrice(input);
  const vetoes: Veto[] = [];
  const finish = (verdict: Verdict, wait: number, until: Date | null, extra: { marginal?: boolean; faded?: boolean } = {}): Decision => ({
    verdict,
    needLabel: need.label,
    score,
    emergency: need.emergency,
    marginal: extra.marginal ?? false,
    faded: extra.faded ?? false,
    components,
    vetoes,
    numbers: {
      cost: round2(cost),
      remaining: round2(remaining),
      budgetDays: round2(cost / daily),
      hoursOfWork: cfg.hourlyIncome ? round2(cost / cfg.hourlyIncome) : null,
      costPerUse: cpu.cpu === null ? null : round2(cpu.cpu),
      effectiveUses: cpu.uses === null ? null : round2(cpu.uses),
      fv10: futureValue(input, a, cfg.realReturn, 10),
      fv20: futureValue(input, a, cfg.realReturn, 20),
      monthlyEquivalent: round2(perMonth ?? (cpu.months ? cost / cpu.months : cost)),
      yearlyCommitment: perMonth === null ? null : round2(perMonth * 12),
      waitHours: wait,
      waitUntil: until ? until.toISOString() : null,
    },
  });
  const waitOrSkip = (veto: Veto, until: Date): Decision => {
    vetoes.push(veto);
    return score >= cfg.thresholds.wait ? finish("WAIT", hoursBetween(now, until), until) : finish("SKIP", 0, null);
  };

  if (a.P1 === "e") return finish("NOT_PERSONAL", 0, null);
  if (cfg.vetoes.debt && (a.P1 === "c" || a.P1 === "d")) vetoes.push("debt");
  if (a.P1 === "b" && !cardAllowed(cfg.vetoes.creditCard, input.merchant)) vetoes.push("card");
  if (need.emergency) return finish("BUY", 0, null);
  if (cfg.vetoes.blockedCategories.some((b) => b.category === input.category && isoDate(now) <= b.until)) {
    vetoes.push("blocked");
    return finish("SKIP", 0, null);
  }
  if (cost > remaining) return waitOrSkip("over_budget", startOfNextMonth(now));
  if (cfg.oneOffs.mode === "cap" && a.O1 && h.oneOffsThisYear + cost > cfg.oneOffs.yearlyCap) {
    return waitOrSkip("oneoff_cap", new Date(now.getFullYear() + 1, 0, 1));
  }
  if (score < cfg.thresholds.wait) return finish("SKIP", 0, null);
  if (a.STILL_WANT === false) return finish("SKIP", 0, null, { faded: true });
  const marginal = score < cfg.thresholds.buy;
  const w = waitHours(cost / budget, a, cfg, now);
  const required = capByDeadline(marginal ? Math.max(2 * w, 24) : w, a, now);
  const start = h.firstCheckTs ? new Date(h.firstCheckTs) : now;
  const until = new Date(start.getTime() + required * HOUR);
  if (now.getTime() < until.getTime() || (marginal && a.STILL_WANT !== true)) return finish("WAIT", required, until, { marginal });
  return finish("BUY", required, null, { marginal });
}

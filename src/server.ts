import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { configHash, deepMerge, loadConfig, loosensAt, resolveConfig, scheduleSchema, stableStringify, type ConfigState } from "./config.js";
import { ARGUMENT_TYPES, CHALLENGE_FIELDS, applyChallenge, isValidValue } from "./engine/challenge.js";
import { ARGUMENT_REPLIES, STATUS_REPLIES, evaluate } from "./engine/explain.js";
import { index, summarize } from "./engine/history.js";
import { QUESTIONS } from "./engine/questions.js";
import { monthBudget, pendingQuestions, spentSoFar } from "./engine/score.js";
import { accuracy, openWaits, reviewsDue } from "./engine/stats.js";
import {
  CATEGORIES,
  type Config,
  type Decision,
  type DecisionSummary,
  type KeyedPrice,
  type LogEvent,
  type OutcomeEvent,
  type PurchaseInput,
  type ReviewEvent,
} from "./engine/types.js";
import { isoDate, localTime, monthKey } from "./engine/util.js";
import { Store } from "./store.js";

const ENGINE_VERSION = "0.1.0";

const INSTRUCTIONS = `Need or Want checks purchases before they happen. Its verdicts come from fixed arithmetic, not from you.
1. When the user wants to buy something, or compares or price-checks something with intent to buy, call check_purchase before helping them buy.
2. Ask the questions it returns as multiple choice, word for word. Show each option's full text as the choice, never bare letters. Pass the option's letter back in answers. Then call check_purchase again with every answer.
3. Never give your own verdict. Relay the tool's message.
4. If the user pushes back, ask which fact changed and call challenge_verdict with that field. If nothing changed, call it with field "none" and the closest argumentType, and relay the reply.
5. When the user buys it or decides not to, call record_outcome. If a response shows reviewsDue above 0, offer to run the reviews.`;

interface State extends ConfigState {
  spentElsewhere: { date: string; amount: number } | null;
}

interface Ctx {
  now: Date;
  cfg: Config;
  st: State;
  events: LogEvent[];
  prices: KeyedPrice[];
  warnings: string[];
}

interface Problem {
  status: string;
  message: string;
}

const SETUP: Problem = {
  status: "setup_needed",
  message: "Run setup first: tell me your currency and your monthly spending budget.",
};

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const keyFor = (input: PurchaseInput): string => (input.productKey ?? input.item).trim().toLowerCase();
const summary = (d: Decision): DecisionSummary => ({
  verdict: d.verdict,
  score: d.score,
  needLabel: d.needLabel,
  cost: d.numbers.cost,
  waitUntil: d.numbers.waitUntil,
});

const answersSchema = z.object({
  N1: z.enum(["a", "b", "c", "d"]).optional(),
  N2: z.enum(["a", "b", "c", "d"]).optional(),
  N3: z.enum(["a", "b", "c"]).optional(),
  N4: z.union([z.literal("none"), z.iso.date()]).optional(),
  U1: z.number().nonnegative().optional(),
  U2: z.number().positive().optional(),
  U3: z.number().nonnegative().optional(),
  S1: z.enum(["a", "b", "c", "d"]).optional(),
  S2: z.enum(["a", "b", "c", "d"]).optional(),
  P1: z.enum(["a", "b", "c", "d"]).optional(),
  O1: z.boolean().optional(),
  SP: z.number().nonnegative().optional(),
  STILL_WANT: z.boolean().optional(),
});

export function createServer(store = new Store(), clock: () => Date = () => new Date()): McpServer {
  const server = new McpServer({ name: "need-or-want", version: ENGINE_VERSION }, { instructions: INSTRUCTIONS });

  const load = (): Ctx | Problem => {
    const now = clock();
    if (!store.exists("config.json")) return SETUP;
    let file: Config;
    try {
      file = loadConfig(store.readJson("config.json", {}));
    } catch (e) {
      return { status: "config_error", message: `config.json is invalid: ${(e as Error).message}` };
    }
    const saved = store.readJson<State>("state.json", { applied: null, pending: null, spentElsewhere: null });
    const { inForce, state } = resolveConfig(file, saved, now);
    const st: State = { ...saved, ...state };
    if (stableStringify(st) !== stableStringify(saved)) store.writeJson("state.json", st);
    if (monthBudget(inForce, now) <= 0) return SETUP;
    const log = store.readLines<LogEvent>("decisions.jsonl");
    const prices = store.readLines<KeyedPrice>("prices.jsonl");
    const skipped = log.skipped + prices.skipped;
    return {
      now,
      cfg: inForce,
      st,
      events: log.items,
      prices: prices.items,
      warnings: skipped ? [`${skipped} unreadable log line(s) were skipped. The files were not changed.`] : [],
    };
  };
  const isCtx = (x: Ctx | Problem): x is Ctx => "cfg" in x;
  const spentToday = (ctx: Ctx): number | null =>
    ctx.st.spentElsewhere?.date === isoDate(ctx.now) ? ctx.st.spentElsewhere.amount : null;
  const dueCount = (ctx: Ctx): number => reviewsDue(ctx.events, ctx.now).length;

  server.registerTool(
    "setup",
    {
      title: "Set up or show settings",
      description:
        "First-time setup, or show the current settings when called with no arguments. Tightening a setting applies at once. Loosening one (higher budget, card allowed) applies only after 7 days.",
      inputSchema: {
        currency: z.string().min(1).optional(),
        monthlyBudget: z.number().positive().optional(),
        schedule: scheduleSchema.optional(),
        creditCard: z.enum(["allow", "block"]).optional(),
        onlyMerchants: z.array(z.string()).optional(),
        hourlyIncome: z.number().positive().optional(),
      },
    },
    async (a) => {
      const patch: Record<string, unknown> = {};
      if (a.currency) patch.currency = a.currency;
      if (a.monthlyBudget || a.schedule) {
        patch.budget = { ...(a.monthlyBudget ? { monthly: a.monthlyBudget } : {}), ...(a.schedule ? { schedule: a.schedule } : {}) };
      }
      if (a.onlyMerchants) patch.vetoes = { creditCard: { onlyMerchants: a.onlyMerchants } };
      else if (a.creditCard) patch.vetoes = { creditCard: a.creditCard };
      if (a.hourlyIncome) patch.hourlyIncome = a.hourlyIncome;
      if (Object.keys(patch).length) store.writeJson("config.json", deepMerge(store.readJson("config.json", {}), patch));
      const ctx = load();
      if (!isCtx(ctx)) return text({ ...ctx, dataFolder: store.dir });
      return text({ status: "ready", dataFolder: store.dir, config: ctx.cfg, pending: ctx.st.pending });
    },
  );

  server.registerTool(
    "check_purchase",
    {
      title: "Check a purchase",
      description:
        "Call this BEFORE helping the user buy anything, or when they compare or price-check something with intent to buy. The first call returns multiple-choice questions: ask them word for word, then call again with every answer in `answers`. The verdict comes from fixed arithmetic: relay its message, never your own opinion. Pick the category that matches how long the thing lasts; if unsure, ask the user. Pass merchant (domain) and productKey (ASIN or URL) when known. Pass spentThisMonth only if a budgeting tool gives it.",
      inputSchema: {
        item: z.string().min(1),
        price: z.number().positive(),
        category: z.enum(CATEGORIES),
        recurring: z.enum(["none", "monthly", "yearly"]).default("none"),
        productKey: z.string().optional(),
        merchant: z.string().optional(),
        spentThisMonth: z.number().nonnegative().optional(),
        sellerClaims: z.array(z.string()).optional(),
        runningCostPerMonth: z.number().nonnegative().optional(),
        resaleValue: z.number().nonnegative().optional(),
        answers: answersSchema.optional(),
      },
    },
    async ({ answers = {}, ...input }) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const key = keyFor(input);
      if (answers.SP !== undefined) {
        ctx.st.spentElsewhere = { date: isoDate(ctx.now), amount: answers.SP };
        store.writeJson("state.json", ctx.st);
      }
      const history = summarize(ctx.events, ctx.prices, input.category, key, spentToday(ctx), ctx.now);
      const missing = pendingQuestions(input, answers, ctx.cfg, history, ctx.now);
      if (missing.length) {
        return text({
          status: "questions",
          instructions: "Ask each question as multiple choice, word for word. Show each option's full text as the choice, never bare letters, and pass the letter back in answers. Then call check_purchase again with every answer.",
          questions: missing.map((id) => QUESTIONS[id]),
          reviewsDue: dueCount(ctx),
          warnings: ctx.warnings,
        });
      }
      const { decision: d, whatWouldChange, message } = evaluate({ input, answers, cfg: ctx.cfg, history, now: ctx.now });
      const id = randomUUID();
      const ts = ctx.now.toISOString();
      store.append("prices.jsonl", { key, price: input.price, ts });
      store.append("decisions.jsonl", {
        type: "verdict",
        id,
        ts,
        key,
        input,
        answers,
        decision: summary(d),
        configHash: configHash(ctx.cfg),
        engineVersion: ENGINE_VERSION,
      });
      return text({
        status: "verdict",
        decisionId: id,
        ...d,
        whatWouldChange,
        sellerClaimsIgnored: input.sellerClaims ?? [],
        message,
        reviewsDue: dueCount(ctx),
        warnings: ctx.warnings,
      });
    },
  );

  server.registerTool(
    "challenge_verdict",
    {
      title: "Challenge a verdict",
      description:
        "Use when the user pushes back on a verdict. Name the ONE input that changed (field) and its new value; a wrong category is a fact too. If no fact changed, use field 'none' with the closest argumentType. The verdict only moves when a fact changes; estimates (U1, U2) revised after a verdict count at 50%, once.",
      inputSchema: {
        decisionId: z.string(),
        field: z.enum(CHALLENGE_FIELDS),
        newValue: z.union([z.number(), z.string(), z.boolean()]).optional(),
        note: z.string().optional(),
        argumentType: z.enum(ARGUMENT_TYPES).optional(),
      },
    },
    async ({ decisionId, field, newValue, note, argumentType }) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const ix = index(ctx.events);
      const v = ix.verdicts.get(decisionId);
      const latest = ix.latest.get(decisionId);
      if (!v || !latest) return text({ status: "error", message: `No decision with id ${decisionId}.` });
      if (!isValidValue(field, newValue)) return text({ status: "error", message: `${String(newValue)} is not a valid value for ${field}.` });
      const r = applyChallenge(latest.input, latest.answers, field, newValue, ix.challenges.get(decisionId) ?? []);
      const before = latest.decision;
      let after = before;
      let message: string;
      if (r.status === "applied") {
        const history = summarize(ctx.events, ctx.prices, r.input.category, v.key, spentToday(ctx), ctx.now);
        const result = evaluate({ input: r.input, answers: r.answers, cfg: ctx.cfg, history, now: ctx.now });
        after = summary(result.decision);
        const longer = before.waitUntil !== null && after.waitUntil !== null && Date.parse(after.waitUntil) > Date.parse(before.waitUntil);
        message = longer
          ? `The wait moved from ${localTime(before.waitUntil as string)} to ${localTime(after.waitUntil as string)}. That isn't a penalty for the new fact: a different rule sets the date now, as "Why this date" explains.\n${result.message}`
          : result.message;
      } else {
        message = r.status === "none" ? ARGUMENT_REPLIES[argumentType ?? "other"] : STATUS_REPLIES[r.status];
      }
      store.append("decisions.jsonl", {
        type: "challenge",
        id: decisionId,
        ts: ctx.now.toISOString(),
        field,
        newValue,
        effectiveValue: r.effectiveValue,
        status: r.status,
        note,
        argumentType,
        input: r.input,
        answers: r.answers,
        decision: after,
      });
      return text({
        status: r.status,
        before,
        after,
        moved: before.verdict !== after.verdict || before.score !== after.score,
        effectiveValue: r.effectiveValue,
        message,
        reviewsDue: dueCount(ctx),
      });
    },
  );

  server.registerTool(
    "record_outcome",
    {
      title: "Record what happened",
      description:
        "Record that the user bought or didn't buy a checked item, or record a 30- or 90-day review. Buying against a non-BUY verdict is logged as an override, with no other friction.",
      inputSchema: {
        decisionId: z.string(),
        event: z.enum(["bought", "not_bought", "review"]),
        price: z.number().positive().optional(),
        day: z.union([z.literal(30), z.literal(90)]).optional(),
        uses: z.number().nonnegative().optional(),
        worthIt: z.enum(["yes", "meh", "no"]).optional(),
        missIt: z.enum(["yes", "no", "other"]).optional(),
      },
    },
    async (a) => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const latest = index(ctx.events).latest.get(a.decisionId);
      if (!latest) return text({ status: "error", message: `No decision with id ${a.decisionId}.` });
      const ts = ctx.now.toISOString();
      if (a.event === "review" && !a.day) return text({ status: "error", message: "A review needs day: 30 or 90." });
      const override = a.event === "bought" && latest.decision.verdict !== "BUY";
      const event: ReviewEvent | OutcomeEvent =
        a.event === "review"
          ? { type: "review", id: a.decisionId, ts, day: a.day as 30 | 90, uses: a.uses, worthIt: a.worthIt, missIt: a.missIt }
          : { type: "outcome", id: a.decisionId, ts, bought: a.event === "bought", price: a.price ?? null, override };
      store.append("decisions.jsonl", event);
      ctx.events.push(event);
      return text({
        status: "recorded",
        override,
        message: override ? "Logged as an override. It will be reviewed in 30 and 90 days like any other purchase." : "Logged.",
        reviewsDue: dueCount(ctx),
      });
    },
  );

  server.registerTool(
    "get_status",
    {
      title: "Status and accuracy",
      description: "Money left this month, waits ending, reviews due, pending setting changes, and how accurate past verdicts were.",
    },
    async () => {
      const ctx = load();
      if (!isCtx(ctx)) return text(ctx);
      const budget = monthBudget(ctx.cfg, ctx.now);
      const spent = spentSoFar({}, {}, summarize(ctx.events, [], null, null, spentToday(ctx), ctx.now));
      return text({
        currency: ctx.cfg.currency,
        month: monthKey(ctx.now),
        budget,
        spent,
        remaining: budget - spent,
        waits: openWaits(ctx.events, ctx.now),
        reviewsDue: reviewsDue(ctx.events, ctx.now),
        pendingConfig: ctx.st.pending ? { since: ctx.st.pending.since, appliesAt: loosensAt(ctx.st) } : null,
        accuracy: accuracy(ctx.events),
        warnings: ctx.warnings,
      });
    },
  );

  server.registerPrompt(
    "should-i-buy",
    { title: "Should I buy it?", description: "Check a purchase before you make it.", argsSchema: { item: z.string(), price: z.string() } },
    ({ item, price }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I'm thinking of buying ${item} for ${price}. Run check_purchase on it, ask me its questions as multiple choice, then give me the verdict exactly as the tool returns it.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt("review", { title: "Review past purchases", description: "Run the 30- and 90-day reviews that are due." }, () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Call get_status, then ask me the review questions for every review that is due, and record each answer with record_outcome.",
        },
      },
    ],
  }));

  return server;
}

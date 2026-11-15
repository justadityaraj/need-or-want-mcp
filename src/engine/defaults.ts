import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  currency: "USD",
  budget: { monthly: 0, schedule: {} },
  vetoes: { debt: true, creditCard: "allow", blockedCategories: [] },
  oneOffs: { mode: "count", yearlyCap: 0 },
  weights: { need: 0.4, budget: 0.25, costPerUse: 0.2, history: 0.1, deal: 0.05 },
  thresholds: { buy: 70, wait: 50 },
  waitBands: [
    { upTo: 0.02, hours: 0 },
    { upTo: 0.05, hours: 24 },
    { upTo: 0.25, hours: 168 },
    { upTo: 1, hours: 720 },
    { upTo: null, hours: 1440 },
  ],
  realReturn: 0.04,
  hourlyIncome: null,
  loosenDelayDays: 7,
  categories: {
    consumable: { lifespanMonths: 1, lambda: 0 },
    health: { lifespanMonths: 6, lambda: 0 },
    work_tool: { lifespanMonths: 36, lambda: 0.01 },
    home: { lifespanMonths: 60, lambda: 0.01 },
    electronics: { lifespanMonths: 36, lambda: 0.08 },
    clothing: { lifespanMonths: 24, lambda: 0.06 },
    hobby: { lifespanMonths: 24, lambda: 0.1 },
    subscription: { lifespanMonths: 12, lambda: 0.05 },
    experience: { lifespanMonths: null, lambda: 0 },
    gift: { lifespanMonths: null, lambda: 0 },
    other: { lifespanMonths: 12, lambda: 0.05 },
  },
};

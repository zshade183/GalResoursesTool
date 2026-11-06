import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ensureUsage, reserveUsage, updateUsage } from "./usage.js";
afterEach(() => vi.unstubAllEnvs());
it("enforces project quota and budget without treating unknown costs as zero", () => {
  const db = new DatabaseSync(":memory:"); ensureUsage(db);
  try {
    vi.stubEnv("MAX_DAILY_GENERATIONS", "2"); vi.stubEnv("PROJECT_DAILY_BUDGET", "5"); vi.stubEnv("IMAGE_ESTIMATE_COST", "");
    expect(() => reserveUsage(db,"a","p","image")).toThrow("未估价");
    vi.stubEnv("IMAGE_ESTIMATE_COST", "3"); reserveUsage(db,"a","p","image");
    expect(() => reserveUsage(db,"b","p","image")).toThrow("预算不足");
    updateUsage(db,"a","cancelled"); expect(db.prepare("SELECT state,actual FROM usage_ledger WHERE id='a'").get()).toMatchObject({ state: "awaiting_reconciliation", actual: null });
    vi.stubEnv("PROJECT_DAILY_BUDGET", ""); reserveUsage(db,"b","p","image");
    expect(() => reserveUsage(db,"c","p","image")).toThrow("限额");
    reserveUsage(db,"d","other","image");
  } finally { db.close(); }
});

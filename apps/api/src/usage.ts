import type { DatabaseSync } from "node:sqlite";
export function ensureUsage(db: DatabaseSync) { db.exec("CREATE TABLE IF NOT EXISTS usage_ledger(id TEXT PRIMARY KEY, project TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, estimate REAL, actual REAL, currency TEXT NOT NULL, state TEXT NOT NULL, evidence TEXT)"); }
export function reserveUsage(db: DatabaseSync, id: string, project: string, kind: "image" | "video" | "audio", quantity = 1) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const limit = Number(process.env.MAX_DAILY_GENERATIONS ?? 100);
  const unit = process.env[kind === "image" ? "IMAGE_ESTIMATE_COST" : kind === "video" ? "VIDEO_ESTIMATE_COST_PER_SECOND" : "AUDIO_ESTIMATE_COST_PER_SECOND"];
  const estimate = unit && Number.isFinite(Number(unit)) && Number(unit) >= 0 ? Number(unit) * quantity : null;
  const budget = process.env.PROJECT_DAILY_BUDGET ? Number(process.env.PROJECT_DAILY_BUDGET) : undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const total = db.prepare("SELECT count(*) AS count, sum(coalesce(actual,estimate,0)) AS amount, sum(CASE WHEN estimate IS NULL AND actual IS NULL THEN 1 ELSE 0 END) AS unknown FROM usage_ledger WHERE project=? AND day=?").get(project, day)!;
    if (!Number.isFinite(limit) || limit < 1 || Number(total.count) >= limit) throw new Error("作品当日任务数量已达限额");
    if (budget !== undefined && (!Number.isFinite(budget) || budget < 0 || estimate === null || Number(total.unknown) > 0 || Number(total.amount ?? 0) + estimate > budget)) throw new Error("预算不足或存在未估价任务，请先核对用量与单价配置");
    db.prepare("INSERT INTO usage_ledger VALUES(?,?,?,?,?,NULL,?,'reserved',NULL)").run(id, project, day, kind, estimate, process.env.USAGE_CURRENCY ?? "USD");
    db.exec("COMMIT");
  } catch(e) { db.exec("ROLLBACK"); throw e; }
}
export function updateUsage(db: DatabaseSync, id: string, state: string) {
  if (["awaiting_review", "approved", "failed", "cancelled", "reconcile_required", "download_failed"].includes(state)) db.prepare("UPDATE usage_ledger SET state='awaiting_reconciliation' WHERE id=? AND actual IS NULL").run(id);
}

import { jobRecordRoutes, matchesJobRecord, type JobRecordQuery } from "./job-records.js";
import { ensureUsage, reserveUsage, updateUsage } from "./usage.js";
import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "./projects.js";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
const schema = z.object({ request_id: z.string().uuid(), name: z.string().trim().min(1).max(200), purpose: z.enum(["bgm", "sfx", "ambience"]), prompt: z.string().trim().min(1).max(4100), duration: z.number().min(0.5).max(300), instrumental: z.boolean(), loop: z.boolean() }).strict().refine(i => i.purpose === "bgm" ? i.duration >= 3 : i.duration <= 30);
type Job = { id: string; project: string; input: z.infer<typeof schema>; state: string; deleted_at?: string; created_at: string; error?: string; approved?: boolean; data?: string };
type Params = { project: string; id: string };
export function audioGenerationRoutes(app: FastifyInstance, repository: ProjectRepository, filename: string) {
  const db = new DatabaseSync(filename); db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS audio_jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");
  ensureUsage(db);
  const jobs = new Map<string, Job>(); const active = new Set<Promise<void>>(); const approving = new Set<string>();
  const save = (job: Job) => { db.prepare("INSERT INTO audio_jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(job.id, JSON.stringify(job)); jobs.set(job.id, job); updateUsage(db, job.id, job.state); };
  const view = ({ data, ...job }: Job) => job;
  for (const row of db.prepare("SELECT payload FROM audio_jobs").all()) { const job = JSON.parse(String(row.payload)) as Job; if (job.state === "running") { job.state = "reconcile_required"; job.error = "服务中断，请核对供应商账单，不能自动重试"; } save(job); }
  app.addHook("onClose", async () => { await Promise.allSettled(active); db.close(); });
  const base = "/v1/projects/:project/audio-jobs";
  app.get("/v1/audio-services", async () => ({ elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) }));
  jobRecordRoutes(app, base, jobs, save, job => approving.has(job.id));
  app.get<{ Params: Params; Querystring: JobRecordQuery }>(base, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    return { items: [...jobs.values()].filter(job => matchesJobRecord(job, request.params.project, request.query)).reverse().map(view) };
  });
  app.post<{ Params: Params }>(base, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    const parsed = schema.safeParse(request.body); if (!parsed.success) return reply.code(400).send({ message: "音乐需 3 至 300 秒，音效需 0.5 至 30 秒，请检查输入" });
    const input = parsed.data, prior = jobs.get(input.request_id);
    if (prior) return !prior.deleted_at && prior.project === request.params.project && JSON.stringify(prior.input) === JSON.stringify(input) ? view(prior) : reply.code(409).send({ message: "请求编号已使用" });
    if (!process.env.ELEVENLABS_API_KEY) return reply.code(400).send({ message: "缺少 ELEVENLABS_API_KEY" });
    if (active.size >= 2) return reply.code(429).send({ message: "已有两个音频任务运行" });
    try { reserveUsage(db, input.request_id, request.params.project, "audio", input.duration); }
    catch(e) { return reply.code(429).send({ message: e instanceof Error ? e.message : "用量预留失败" }); }
    const job: Job = { id: input.request_id, project: request.params.project, input, state: "running", created_at: new Date().toISOString() }; save(job);
    const task = (async () => { try {
      const music = input.purpose === "bgm";
      const response = await fetch(`https://api.elevenlabs.io/v1/${music ? "music" : "sound-generation"}?output_format=mp3_44100_128`, { method: "POST", redirect: "error", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" }, signal: AbortSignal.timeout(300000), body: JSON.stringify(music ? { prompt: input.prompt, music_length_ms: Math.round(input.duration * 1000), force_instrumental: input.instrumental, model_id: "music_v1" } : { text: input.prompt, duration_seconds: input.duration, loop: input.loop, model_id: "eleven_text_to_sound_v2" }) });
      if (!response.ok || !response.body) throw new Error(`音频服务 HTTP ${response.status}，请核对权限与额度`);
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("音频超过 20MB"); } chunks.push(value); }
      const bytes = Buffer.concat(chunks); if (!(bytes.toString("ascii", 0, 3) === "ID3" || bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0)) throw new Error("服务返回了无效 MP3");
      job.data = bytes.toString("base64"); job.state = "awaiting_review";
    } catch(e) { job.state = "reconcile_required"; job.error = e instanceof Error ? e.message : "生成状态未知"; } save(job); })(); active.add(task); void task.finally(() => active.delete(task));
    return reply.code(202).send(view(job));
  });
  app.get<{ Params: Params }>(base + "/:id/file", async (request, reply) => { const job = jobs.get(request.params.id); if (!job || job.project !== request.params.project || !job.data) return reply.code(404).send({ message: "音频不存在" }); return reply.type("audio/mpeg").send(Buffer.from(job.data, "base64")); });
  app.post<{ Params: Params }>(base + "/:id/approve", async (request, reply) => {
    const job = jobs.get(request.params.id); if (!job || job.deleted_at || job.project !== request.params.project || !job.data) return reply.code(404).send({ message: "候选不存在" });
    if (approving.has(job.id)) return reply.code(409).send({ message: "正在保存" }); approving.add(job.id);
    try { if (!(await repository.music(job.project)).some(item => item.id === job.id)) await repository.addMusic({ id: job.id, project_id: job.project, name: job.input.name, purpose: job.input.purpose, source: `ElevenLabs / ${job.id}`, mime: "audio/mpeg", data: job.data, created_at: job.created_at }); job.approved = true; job.state = "approved"; save(job); return view(job); } finally { approving.delete(job.id); }
  });
}

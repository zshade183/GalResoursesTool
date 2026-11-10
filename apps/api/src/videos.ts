import { jobRecordRoutes, matchesJobRecord, type JobRecordQuery } from "./job-records.js";
import { arkLocalImage } from "./ark-image.js";
import { arkConfig, arkHeaders, arkModelIssue, arkService, arkVideoCapability, arkVideoModels, arkVideoPath } from "./ark.js";
import { arkVideoBody, arkVideoInput, arkVideoIssue } from "./ark-video.js";
import { ensureUsage, reserveUsage, updateUsage } from "./usage.js";
import { randomUUID } from "node:crypto";
import { ffmpegAvailable, processVideo } from "./video-processing.js";
import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "./projects.js";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { downloadMedia } from "./download.js";
const runwayInput = z.object({ provider: z.literal("runway").optional(), request_id: z.string().uuid(), character_id: z.string().min(1), reference_id: z.string().min(1), prompt: z.string().trim().min(1).max(850), camera: z.enum(["fixed", "moving"]), duration: z.union([z.literal(5), z.literal(10)]), ratio: z.enum(["1280:720", "720:1280", "960:960"]), loop_intent: z.boolean() }).strict();
const inputSchema = z.union([arkVideoInput, runwayInput]);
type Input = z.infer<typeof inputSchema>;
type Job = { id: string; project: string; input: Input; state: string; deleted_at?: string; provider_id?: string; provider_status?: string; error?: string; created_at: string; approved: boolean; loop_verified: boolean; duration_seconds?: number; parent_id?: string; muted?: boolean };
type Params = { project: string; id: string };
export function videoRoutes(app: FastifyInstance, repository: ProjectRepository, filename: string) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS video_jobs(id TEXT PRIMARY KEY, project TEXT NOT NULL, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS video_files(id TEXT PRIMARY KEY, bytes BLOB NOT NULL)");
  ensureUsage(db);
  const jobs = new Map<string, Job>();
  const active = new Map<string, Promise<void>>();
  let closing = false;
  const save = (job: Job) => { db.prepare("INSERT INTO video_jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(job.id, job.project, JSON.stringify(job)); jobs.set(job.id, job); updateUsage(db, job.id, job.state); };
  for (const row of db.prepare("SELECT payload FROM video_jobs").all()) { const job = JSON.parse(String(row.payload)) as Job; if (["submitting", "queued", "processing"].includes(job.state)) { job.state = "reconcile_required"; job.error = "提交状态未知，请核对供应商记录，不要直接重复提交。"; } save(job); }
  const base = "/v1/projects/:project/videos";
  const headers = () => ({ Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, "X-Runway-Version": "2024-11-06", "Content-Type": "application/json" });
  const endpoint = "https://api.dev.runwayml.com/v1";
  async function provider(input: Input, path: string, options: RequestInit = {}) {
    const ark = input.provider === "seedance" ? arkConfig(input.ark_profile, "video") : undefined;
    if (ark && !ark.key) throw new Error("缺少提交该任务时使用的方舟配置。");
    const response = await fetch((ark?.base ?? endpoint) + path, {
      ...options, headers: ark ? arkHeaders(ark.key!) : headers(),
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      let code = "";
      let message = "";
      if (ark) {
        const body = await response.json().catch(() => undefined) as { error?: { code?: string; message?: string } } | undefined;
        code = body?.error?.code ?? "";
        message = body?.error?.message?.replaceAll(ark.key!, "[已隐藏密钥]").slice(0, 700) ?? "";
      } else await response.body?.cancel();
      throw new Error(`视频服务 HTTP ${response.status}${code ? " · " + code : ""}。 ${code === "ModelNotOpen" ? "请在方舟开通管理中开通所选 Seedance 模型。" : message || "请检查额度、权限或稍后查询。"}`);
    }
    return response;
  }
  async function poll(job: Job) {
    try {
      const ark = job.input.provider === "seedance";
      const path = ark ? arkVideoPath(job.provider_id) : `/tasks/${encodeURIComponent(job.provider_id!)}`;
      const result = await (await provider(job.input, path)).json() as {
        status: string; output?: string[]; content?: { video_url?: string }; duration?: number; error?: { code?: string };
      };
      const status = result.status?.toLowerCase();
      job.provider_status = status;
      if (closing) return;
      if (status === "succeeded") {
        job.state = "processing"; save(job);
        const output = ark ? result.content?.video_url : result.output?.[0];
        if (!output) throw new Error("服务未返回视频文件");
        const bytes = await downloadMedia(output, 100 * 1024 * 1024);
        if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("服务返回的文件不是 MP4");
        db.prepare("INSERT INTO video_files VALUES(?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes").run(job.id, bytes);
        if (ark && Number.isFinite(result.duration) && result.duration! > 0) job.duration_seconds = result.duration;
        job.state = "awaiting_review"; job.error = undefined;
      } else if (status === "cancelled") {
        job.state = "cancelled"; job.error = undefined;
      } else if (status === "failed" || status === "expired") {
        job.state = "failed";
        job.error = status === "expired" ? "供应商视频任务已过期。" : `供应商生成失败${result.error?.code ? "：" + result.error.code : "，请核对供应商记录。"}`;
      } else if (["queued", "running", "pending", "throttled"].includes(status)) {
        job.state = "running"; job.error = undefined;
      } else {
        job.state = "reconcile_required"; job.error = "供应商返回了未知状态，请重新查询。";
      }
    } catch (error) { job.error = error instanceof Error ? error.message : "查询失败"; if (job.state === "processing") job.state = "download_failed"; }
    save(job);
  }
  function launch(job: Job, task: () => Promise<void>) {
    if (active.has(job.id) || closing) return;
    const promise = task().finally(() => active.delete(job.id)); active.set(job.id, promise);
  }
  const timer = setInterval(() => { for (const job of jobs.values()) if (job.provider_id && job.state === "running") {
    if (Date.now() - Date.parse(job.created_at) > 3600000) { job.state = "reconcile_required"; job.error = "任务超过一小时，请手动查询服务状态"; save(job); }
    else launch(job, () => poll(job));
  } }, 10000);
  timer.unref();
  app.addHook("onClose", async () => { closing = true; clearInterval(timer); await Promise.allSettled(active.values()); db.close(); });
  app.get("/v1/video-services", async () => ({
    runway: Boolean(process.env.RUNWAYML_API_SECRET), ffmpeg: await ffmpegAvailable(),
    model: "gen4_turbo", durations: [5, 10], ratios: ["1280:720", "720:1280", "960:960"],
    ark: Object.fromEntries((["standard", "agent-plan"] as const).map(profile => {
      const service = arkService(profile, "video");
      const models = [...new Set([service.model, ...arkVideoModels[profile]].filter((model): model is string => Boolean(model)))];
      return [profile, { ...service, models: models.flatMap(id => {
        const capability = arkVideoCapability(id, profile);
        return capability ? [{ id, ...capability }] : [];
      }) }];
    })),
  }));
  jobRecordRoutes(app, base, jobs, save, job => active.has(job.id));
  app.get<{ Params: Params; Querystring: JobRecordQuery }>(base, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    return { items: [...jobs.values()].filter(job => matchesJobRecord(job, request.params.project, request.query)).reverse() };
  });
  app.post<{ Params: Params }>(base, async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "视频参数无效" });
    const input = parsed.data;
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    const prior = jobs.get(input.request_id);
    if (prior) return !prior.deleted_at && prior.project === request.params.project && JSON.stringify(prior.input) === JSON.stringify(input) ? prior : reply.code(409).send({ message: "请求编号已使用" });
    if ([...jobs.values()].filter(job => ["submitting", "running", "processing"].includes(job.state)).length >= 2) return reply.code(429).send({ message: "最多同时运行两个视频任务" });
    const prompt = `${input.camera === "fixed" ? "固定镜头。" : "镜头平稳移动。"} ${input.prompt}${input.loop_intent ? " 尽量使首尾动作衔接。" : ""}`;
    let path: string;
    let body: object;
    let estimatedDuration = input.duration;
    if (input.provider === "seedance") {
      const config = arkService(input.ark_profile, "video");
      if (!config.configured) return reply.code(400).send({ message: config.error ?? "请配置所选方舟服务的 API Key。" });
      const modelIssue = arkModelIssue(input.model, input.ark_profile, "video");
      if (modelIssue) return reply.code(400).send({ message: modelIssue });
      const capability = arkVideoCapability(input.model, input.ark_profile);
      if (!capability) return reply.code(400).send({ message: "未知 Seedance 型号。使用 ep- 接入点时，请在后端配置对应的基础模型。" });
      const issue = arkVideoIssue(input, capability);
      if (issue) return reply.code(400).send({ message: issue });
      const selected = [input.first_frame, input.last_frame, ...(input.reference_images ?? [])].filter(item => item !== undefined);
      const images = await Promise.all(selected.map(async item => {
        const assets = await repository.references(request.params.project, item.character_id);
        return assets.find(asset => asset.id === item.reference_id)?.data_url;
      }));
      if (images.some(image => !image)) return reply.code(400).send({ message: "部分参考图不属于此作品。" });
      try {
        for (const image of images) {
          const { width, height, ratio } = arkLocalImage(image!);
          if (Math.min(width, height) < 300 || Math.max(width, height) > 6000 || ratio < 0.4 || ratio > 2.5) {
            throw new Error("Seedance 图片边长须为 300 至 6000 像素，宽高比须为 0.4 至 2.5。");
          }
        }
      } catch (error) { return reply.code(400).send({ message: (error as Error).message }); }
      let offset = 0;
      const first = input.first_frame ? images[offset++] : undefined;
      const last = input.last_frame ? images[offset++] : undefined;
      body = arkVideoBody(input, prompt, { first, last, references: images.slice(offset) as string[] });
      path = arkVideoPath();
      if (input.duration === -1) estimatedDuration = capability.durationMax;
    } else {
      if (!process.env.RUNWAYML_API_SECRET) return reply.code(400).send({ message: "请先配置 RUNWAYML_API_SECRET" });
      const reference = (await repository.references(request.params.project, input.character_id)).find(item => item.id === input.reference_id);
      if (!reference || await repository.standardReference(request.params.project, input.character_id) !== reference.id) return reply.code(400).send({ message: "请先确认该对象的标准参考图" });
      if (reference.data_url.length > 5 * 1024 * 1024) return reply.code(400).send({ message: "参考图编码后需小于 5MB，请先缩小图片" });
      path = "/image_to_video";
      body = { model: "gen4_turbo", promptImage: reference.data_url, promptText: prompt, ratio: input.ratio, duration: input.duration };
    }
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 64 * 1024 * 1024) return reply.code(400).send({ message: "视频请求体超过 64MB，请减少本地参考图或改用素材链接。" });
    const raced = jobs.get(input.request_id);
    if (raced) return !raced.deleted_at && raced.project === request.params.project && JSON.stringify(raced.input) === JSON.stringify(input) ? raced : reply.code(409).send({ message: "请求编号已使用" });
    if ([...jobs.values()].filter(job => ["submitting", "running", "processing"].includes(job.state)).length >= 2) return reply.code(429).send({ message: "最多同时运行两个视频任务" });
    try { reserveUsage(db, input.request_id, request.params.project, "video", estimatedDuration); }
    catch(e) { return reply.code(429).send({ message: e instanceof Error ? e.message : "用量预留失败" }); }
    const job: Job = { id: input.request_id, project: request.params.project, input, state: "submitting", approved: false, loop_verified: false, created_at: new Date().toISOString() };
    save(job);
    launch(job, async () => {
      try {
        const result = await (await provider(input, path, { method: "POST", body: payload })).json() as { id?: string };
        if (!result.id) throw new Error("服务未返回任务编号");
        job.provider_id = result.id; job.state = "running";
      } catch (error) { job.state = "reconcile_required"; job.error = error instanceof Error ? error.message : "提交状态未知"; }
      save(job);
    });
    return reply.code(202).send(job);
  });
  for (const action of ["refresh", "cancel", "approve"] as const) app.post<{ Params: Params }>(base + `/:id/${action}`, async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job || job.deleted_at || job.project !== request.params.project) return reply.code(404).send({ message: "任务不存在" });
    if (active.has(job.id)) return reply.code(409).send({ message: "任务正在处理，请稍后重试" });
    if (action === "approve") {
      if (!["awaiting_review", "approved"].includes(job.state)) return reply.code(409).send({ message: "视频尚不可确认" });
      const body = z.object({ loop_verified: z.boolean() }).strict().safeParse(request.body);
      if (!body.success) return reply.code(400).send({ message: "请提交循环检查结果" });
      job.approved = true; job.loop_verified = body.data.loop_verified; job.state = "approved"; save(job); return job;
    }
    if (!job.provider_id) return reply.code(409).send({ message: "没有供应商编号，需要人工核对提交记录" });
    if (["approved", "awaiting_review", "cancelled", "failed"].includes(job.state)) return reply.code(409).send({ message: "该任务已经结束" });
    if (action === "refresh") launch(job, () => poll(job));
    else if (job.input.provider === "seedance") return reply.code(409).send({ message: "请在方舟控制台取消排队任务。方舟的删除接口对已结束任务会删除记录。" });
    else launch(job, async () => { try { await provider(job.input, `/tasks/${encodeURIComponent(job.provider_id!)}`, { method: "DELETE" }); job.state = "cancelled"; job.error = undefined; } catch (error) { job.error = error instanceof Error ? error.message : "取消失败"; } save(job); });
    return reply.code(202).send(job);
  });
  app.post<{ Params: Params }>(base + "/:id/process", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job || job.deleted_at || job.project !== request.params.project) return reply.code(404).send({ message: "视频不存在" });
    const parsed = z.object({ start: z.number().min(0), end: z.number().positive().max(30), mute: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success || parsed.data.end <= parsed.data.start || parsed.data.end > (job.duration_seconds ?? job.input.duration)) return reply.code(400).send({ message: "裁剪范围无效" });
    if (active.has(job.id)) return reply.code(409).send({ message: "正在处理，请稍后重试" });
    const row = db.prepare("SELECT bytes FROM video_files WHERE id=?").get(job.id);
    if (!row) return reply.code(409).send({ message: "原文件尚未保存" });
    if (!await ffmpegAvailable()) return reply.code(503).send({ message: "请安装 FFmpeg 并配置 FFMPEG_PATH 后重试" });
    if (jobs.get(job.id)?.deleted_at) return reply.code(409).send({ message: "此任务已移入回收站，请恢复后再处理。" });
    const child: Job = { ...job, id: randomUUID(), parent_id: job.id, provider_id: undefined, approved: false, loop_verified: false, state: "processing", error: undefined, muted: parsed.data.mute, duration_seconds: parsed.data.end - parsed.data.start, created_at: new Date().toISOString() };
    save(child);
    launch(child, async () => { try { const bytes = await processVideo(Buffer.from(row.bytes as Uint8Array), parsed.data.start, parsed.data.end, parsed.data.mute); db.prepare("INSERT INTO video_files VALUES(?,?)").run(child.id, bytes); child.state = "awaiting_review"; } catch(e) { child.state = "failed"; child.error = e instanceof Error ? e.message : "处理失败"; } save(child); });
    return reply.code(202).send(child);
  });
  app.get<{ Params: Params }>(base + "/:id/file", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job || job.project !== request.params.project) return reply.code(404).send({ message: "视频不存在" });
    const row = db.prepare("SELECT bytes FROM video_files WHERE id=?").get(job.id);
    if (!row) return reply.code(404).send({ message: "视频尚未保存" });
    const bytes = Buffer.from(row.bytes as Uint8Array);
    reply.type("video/mp4").header("Accept-Ranges", "bytes").header("Content-Disposition", `inline; filename="${job.id}.mp4"`);
    const range = request.headers.range;
    if (!range) return reply.send(bytes);
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) return reply.code(416).header("Content-Range", `bytes */${bytes.length}`).send();
    const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) return reply.code(416).header("Content-Range", `bytes */${bytes.length}`).send();
    return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1));
  });
}

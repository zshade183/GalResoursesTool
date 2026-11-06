import { ensureUsage, reserveUsage, updateUsage } from "./usage.js";
import { downloadMedia } from "./download.js";
import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "./projects.js";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { z } from "zod";

const inputSchema = z.object({
  request_id: z.string().uuid(),
  provider: z.enum(["openai", "seedream", "comfyui"]),
  prompt: z.string().trim().min(1).max(16000),
  model: z.string().max(200).default(""),
  size: z.string().max(30).default("1024x1024"),
  reference_id: z.string().optional(),
  workflow: z.record(z.string(), z.unknown()).optional(),
});
type Input = z.infer<typeof inputSchema>;
type Job = {
  id: string; project: string; character: string; input: Input;
  state: string; error?: string; outputs: string[]; approved: Record<string, string>;
  created_at: string; provider_id?: string; style?: { id: string; rules: string };
};
type Params = { project: string; character: string; job: string };

async function checkedFetch(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
  return response;
}

async function imageData(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("图片响应为空");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("生成图片超过 20MB"); }
    chunks.push(part.value);
  }
  const bytes = Buffer.concat(chunks);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    ? "image/png" : bytes[0] === 255 && bytes[1] === 216
      ? "image/jpeg" : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : undefined;
  if (!mime) throw new Error("服务返回了不支持的图片格式");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function generationRoutes(app: FastifyInstance, repository: ProjectRepository, filename: string) {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS image_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)");
  ensureUsage(db);
  const jobs = new Map<string, Job>();
  const save = (job: Job) => {
    db.prepare("INSERT INTO image_jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(job.id, JSON.stringify(job));
    jobs.set(job.id, job); updateUsage(db, job.id, job.state);
  };
  for (const row of db.prepare("SELECT payload FROM image_jobs").all()) {
    const job = JSON.parse(String(row.payload)) as Job;
    if (["queued", "running"].includes(job.state)) {
      job.state = "reconcile_required";
      job.error = "服务在任务完成前退出，请核对供应商记录后决定是否重新提交。";
    }
    save(job);
  }
  const active = new Set<Promise<void>>();
  const approving = new Set<string>();
  const pending: { job: Job; reference?: string }[] = [];
  let closing = false;
  function drain() {
    while (!closing && active.size < 2 && pending.length) {
      const next = pending.shift()!;
      if (next.job.state === "cancelled") continue;
      const task = execute(next.job, next.reference); active.add(task);
      void task.finally(() => { active.delete(task); drain(); });
    }
  }
  app.addHook("onClose", async () => { closing = true; await Promise.allSettled(active); db.close(); });
  const base = "/v1/projects/:project/characters/:character/generation";
  app.get("/v1/image-services", async () => ({
    openai: Boolean(process.env.IMAGE_API_KEY),
    seedream: Boolean(process.env.SEEDREAM_API_KEY),
    comfyui: true,
  }));
  app.post<{ Params: { provider: string } }>("/v1/image-services/:provider/test", async (request, reply) => {
    const provider = request.params.provider;
    if (!["openai", "seedream", "comfyui"].includes(provider)) return reply.code(400).send({ message: "未知服务" });
    const comfy = provider === "comfyui";
    const seedream = provider === "seedream";
    const key = seedream ? process.env.SEEDREAM_API_KEY : process.env.IMAGE_API_KEY;
    if (!comfy && !key) return reply.code(400).send({ message: "未配置 API Key，请填写 .env 后重启。" });
    const endpoint = (comfy ? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" : seedream ? process.env.SEEDREAM_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3" : process.env.IMAGE_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    try {
      const response = await fetch(endpoint + (comfy ? "/system_stats" : "/models"), {
        headers: comfy ? {} : { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000), redirect: "error",
      });
      await response.body?.cancel();
      if (!response.ok) return reply.code(502).send({ message: `服务返回 HTTP ${response.status}。请检查地址和权限，部分兼容服务不支持模型列表检测。` });
      return { message: comfy ? "ComfyUI 服务可达。具体工作流仍取决于已安装的模型和节点。" : "服务鉴权与连接成功。图片模型调用权限需通过实际生成验证。" };
    } catch { return reply.code(502).send({ message: "服务连接失败或超时，请检查地址、网络和服务进程。" }); }
  });

  async function execute(job: Job, reference?: string) {
    job.state = "running";
    save(job);
    try {
      const { provider, model, size } = job.input;
      const prompt = [job.input.prompt, job.style?.rules].filter(Boolean).join("\n作品风格：");
      if (provider === "comfyui") {
        const endpoint = (process.env.COMFYUI_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
        let referenceName = "";
        if (reference) {
          const blob = await (await fetch(reference)).blob();
          const form = new FormData();
          form.append("image", blob, `${job.id}.png`);
          const uploaded = await (await checkedFetch(endpoint + "/upload/image", { method: "POST", body: form })).json() as { name: string; subfolder?: string };
          referenceName = uploaded.subfolder ? uploaded.subfolder + "/" + uploaded.name : uploaded.name;
        }
        const replace = (value: unknown): unknown => {
          if (value === "{{prompt}}") return prompt;
          if (value === "{{image}}") return referenceName;
          if (Array.isArray(value)) return value.map(replace);
          if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
          return value;
        };
        const submitted = await (await checkedFetch(endpoint + "/prompt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: replace(job.input.workflow), client_id: job.id }),
        })).json() as { prompt_id?: string; error?: unknown };
        if (!submitted.prompt_id || submitted.error) throw new Error("ComfyUI 拒绝工作流，请检查模型和节点");
        job.provider_id = submitted.prompt_id;
        save(job);
        for (let attempt = 0; attempt < 600; attempt++) {
          const history = await (await checkedFetch(endpoint + "/history/" + encodeURIComponent(submitted.prompt_id))).json() as Record<string, { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
          const result = history[submitted.prompt_id];
          if (result?.status?.status_str === "error") throw new Error("ComfyUI 工作流执行失败");
          if (result?.status?.completed) {
            const images = Object.values(result.outputs ?? {}).flatMap(output => output.images ?? []).slice(0, 8);
            for (const image of images) job.outputs.push(await imageData(await checkedFetch(endpoint + "/view?" + new URLSearchParams(image))));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } else {
        const seedream = provider === "seedream";
        const endpoint = (seedream ? process.env.SEEDREAM_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3" : process.env.IMAGE_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
        const key = seedream ? process.env.SEEDREAM_API_KEY : process.env.IMAGE_API_KEY;
        if (!key) throw new Error("请配置对应服务的 API Key");
        let body: BodyInit;
        const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
        let path = "/images/generations";
        if (reference && !seedream) {
          const form = new FormData();
          form.append("model", model);
          form.append("prompt", prompt);
          form.append("size", size);
          form.append("n", "1");
          form.append("image", await (await fetch(reference)).blob(), "reference.png");
          body = form;
          path = "/images/edits";
        } else {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify({ model, prompt, size, ...(seedream ? { watermark: false, ...(reference ? { image: reference } : {}) } : { n: 1 }) });
        }
        const result = await (await checkedFetch(endpoint + path, { method: "POST", headers, body })).json() as { data?: { b64_json?: string; url?: string }[] };
        for (const image of (result.data ?? []).slice(0, 8)) {
          if (image.b64_json) {
            if (image.b64_json.length > 28 * 1024 * 1024) throw new Error("生成图片超过大小限制");
            job.outputs.push(await imageData(new Response(Buffer.from(image.b64_json, "base64"))));
          } else if (image.url) {
            const url = new URL(image.url);
            if (url.protocol !== "https:") throw new Error("远程图片必须使用 HTTPS");
            job.outputs.push(await imageData(new Response(await downloadMedia(url.href, 20 * 1024 * 1024))));
          }
        }
      }
      if (!job.outputs.length) throw new Error("未获取到图片，请核对供应商任务记录");
      job.state = "awaiting_review";
    } catch (error) {
      job.state = "reconcile_required";
      job.error = error instanceof Error ? error.message : "生成失败，请核对服务记录";
    }
    save(job);
  }

  app.get<{ Params: { project: string } }>("/v1/projects/:project/image-jobs", async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    return { items: [...jobs.values()].filter(job => job.project === request.params.project).reverse().map(({ outputs, ...job }) => ({ ...job, output_count: outputs.length })) };
  });
  app.post<{ Params: Params }>(base + "/:job/cancel", async (request, reply) => {
    const job = jobs.get(request.params.job);
    if (!job || job.project !== request.params.project || job.character !== request.params.character) return reply.code(404).send({ message: "任务不存在" });
    if (job.state !== "queued") return reply.code(409).send({ message: "任务已提交到服务，不能保证撤销，请等待结果或核对服务记录" });
    job.state = "cancelled"; save(job); return job;
  });
  app.get<{ Params: Params }>(base, async request => ({
    items: [...jobs.values()].filter(job => job.project === request.params.project && job.character === request.params.character).reverse(),
  }));
  app.post<{ Params: Params }>(base, async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "生成参数无效" });
    const input = parsed.data;
    if (input.provider === "openai" && !process.env.IMAGE_API_KEY) return reply.code(400).send({ message: "缺少 IMAGE_API_KEY，请配置后重启" });
    if (input.provider === "seedream" && !process.env.SEEDREAM_API_KEY) return reply.code(400).send({ message: "缺少 SEEDREAM_API_KEY，请配置后重启" });
    const prior = jobs.get(input.request_id);
    if (prior) {
      if (prior.project !== request.params.project || prior.character !== request.params.character || JSON.stringify(prior.input) !== JSON.stringify(input)) return reply.code(409).send({ message: "请求编号已被使用" });
      return prior;
    }
    if (!(await repository.characters(request.params.project)).some(c => c.id === request.params.character)) return reply.code(404).send({ message: "角色不存在" });
    if (input.provider === "comfyui" ? !input.workflow || !Object.values(input.workflow).every(node => node && typeof node === "object" && "class_type" in node && "inputs" in node) : !input.model.trim()) return reply.code(400).send({ message: "请填写模型 ID 或导入 ComfyUI API 格式工作流" });
    const reference = input.reference_id ? (await repository.references(request.params.project, request.params.character)).find(image => image.id === input.reference_id) : undefined;
    if (input.reference_id && !reference) return reply.code(400).send({ message: "参考图不存在" });
    if (pending.length >= 20) return reply.code(429).send({ message: "等待队列已满，请稍后提交" });
    const raced = jobs.get(input.request_id);
    if (raced) return raced.project === request.params.project && raced.character === request.params.character && JSON.stringify(raced.input) === JSON.stringify(input) ? raced : reply.code(409).send({ message: "请求编号已被使用" });
    try { reserveUsage(db, input.request_id, request.params.project, "image", 1); }
    catch(e) { return reply.code(429).send({ message: e instanceof Error ? e.message : "用量预留失败" }); }
    const job: Job = { id: input.request_id, project: request.params.project, character: request.params.character, input, state: "queued", outputs: [], approved: {}, created_at: new Date().toISOString() };
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='studio_records'").get()) {
      const row = db.prepare("SELECT payload FROM studio_records WHERE project=? AND kind='styles' ORDER BY rowid DESC LIMIT 1").get(job.project);
      if (row) { const style = JSON.parse(String(row.payload)); job.style = { id: style.id, rules: style.rules }; }
    }
    save(job);
    pending.push({ job, reference: reference?.data_url });
    drain();
    return reply.code(202).send(job);
  });
  app.post<{ Params: Params; Body: { index: number } }>(base + "/:job/approve", async (request, reply) => {
    const job = jobs.get(request.params.job);
    const index = request.body?.index;
    if (!job || job.project !== request.params.project || job.character !== request.params.character || !Number.isInteger(index) || !job.outputs[index]) return reply.code(404).send({ message: "候选不存在" });
    const approvalKey = job.id + ":" + index;
    if (approving.has(approvalKey)) return reply.code(409).send({ message: "正在入库，请稍后刷新" });
    approving.add(approvalKey);
    try {
    const digest = createHash("sha256").update(approvalKey).digest("hex");
    const id = job.approved[String(index)] ?? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const existing = (await repository.references(job.project, job.character)).find(image => image.id === id);
    if (!existing) await repository.addReference({ id, project_id: job.project, character_id: job.character, name: "生成候选-" + (index + 1), source: `${job.input.provider} / ${job.input.model} / ${job.id}`, data_url: job.outputs[index]!, created_at: new Date().toISOString() });
    job.approved[String(index)] = id;
    if (job.outputs.every((_, i) => job.approved[String(i)])) job.state = "approved";
    save(job);
    return { id };
    } finally { approving.delete(approvalKey); }
  });
}

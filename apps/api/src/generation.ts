import { jobRecordRoutes, matchesJobRecord, type JobRecordQuery } from "./job-records.js";
import { arkLocalImage } from "./ark-image.js";
import { arkConfig, arkImageCapability, arkImageModels, arkModelIssue, arkService } from "./ark.js";
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
  ark_profile: z.enum(["standard", "agent-plan"]).optional(),
  image_mode: z.enum(["text", "reference", "layers"]).optional(),
  reference_ids: z.array(z.string().min(1)).max(14).optional(),
  transparent_background: z.boolean().optional(),
  group_count: z.number().int().min(2).max(15).optional(),
  workflow: z.record(z.string(), z.unknown()).optional(),
});
type Input = z.infer<typeof inputSchema>;
type Job = {
  id: string; project: string; character: string; input: Input;
  state: string; deleted_at?: string; error?: string; outputs: string[]; approved: Record<string, string>;
  output_details?: { name?: string; z_index?: number; bounding_box?: unknown; size?: string }[];
  created_at: string; provider_id?: string; style?: { id: string; rules: string; reference_id?: string; reference?: string };
};
type Params = { project: string; character: string; job: string };

async function checkedFetch(url: string, options: RequestInit = {}) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(180000) });
  if (!response.ok) {
    let detail = "";
    let errorCode: string | undefined;
    try {
      const payload = await response.json() as { error?: { code?: string; message?: string } };
      errorCode = payload.error?.code;
      detail = [payload.error?.code, payload.error?.message].filter(value => typeof value === "string").join("：");
      for (const key of [process.env.ARK_API_KEY, process.env.ARK_PLAN_API_KEY, process.env.AGENT_API_KEY, process.env.SEEDREAM_API_KEY, process.env.IMAGE_API_KEY]) if (key) detail = detail.replaceAll(key, "[已隐藏密钥]");
      detail = detail.slice(0, 1000);
    } catch { /* Non-JSON provider errors still retain their HTTP status. */ }
    const hint = errorCode === "ModelNotOpen"
      ? "当前火山方舟账号尚未开通此模型。请在控制台的「开通管理」开通对应模型后再提交。"
      : response.status === 404 ? "模型或接入点不存在，或当前密钥无调用权限；模型列表可见不代表已开通。" : response.status === 400 ? "请检查模型支持的尺寸和参数。" : response.status === 401 ? "API Key 无效或已过期。" : response.status === 403 ? "当前账户没有调用权限。" : "请核对服务记录。";
    throw new Error(`服务返回 HTTP ${response.status}：${hint}${detail ? "\n供应商详情：" + detail : ""}`);
  }
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
  const pending: { job: Job; reference?: string; extraReferences?: string[] }[] = [];
  let closing = false;
  function drain() {
    while (!closing && active.size < 2 && pending.length) {
      const next = pending.shift()!;
      if (next.job.state === "cancelled") continue;
      const task = execute(next.job, next.reference, next.extraReferences); active.add(task);
      void task.finally(() => { active.delete(task); drain(); });
    }
  }
  app.addHook("onClose", async () => { closing = true; await Promise.allSettled(active); db.close(); });
  const base = "/v1/projects/:project/characters/:character/generation";
  app.get("/v1/image-services", async () => ({
    openai: Boolean(process.env.IMAGE_API_KEY),
    seedream: arkService("standard", "image").configured,
    ark: Object.fromEntries((["standard", "agent-plan"] as const).map(profile => [profile, {
      ...arkService(profile, "image"),
      models: [...new Set([arkService(profile, "image").model, ...arkImageModels[profile]].filter((model): model is string => Boolean(model)))].map(model => ({ id: model, ...arkImageCapability(model, profile) })),
    }])),
    comfyui: true,
  }));
  app.post<{ Params: { provider: string }; Querystring: { profile?: string } }>("/v1/image-services/:provider/test", async (request, reply) => {
    const provider = request.params.provider;
    if (!["openai", "seedream", "comfyui"].includes(provider)) return reply.code(400).send({ message: "未知服务" });
    const comfy = provider === "comfyui";
    const seedream = provider === "seedream";
    const profile = request.query.profile === "agent-plan" ? "agent-plan" : "standard";
    let config;
    try { config = seedream ? arkConfig(profile, "image") : undefined; }
    catch (error) { return reply.code(400).send({ message: (error as Error).message }); }
    const key = seedream ? config?.key : process.env.IMAGE_API_KEY;
    if (!comfy && !key) return reply.code(400).send({ message: "未配置对应服务的 API Key，请填写 .env 后重启。" });
    if (seedream && profile === "agent-plan") return { message: "已读取 Agent Plan 专属配置。请在方舟订阅页确认模型权限，普通方舟模型列表不能验证套餐权限。" };
    const endpoint = (comfy ? process.env.COMFYUI_URL ?? "http://127.0.0.1:8188" : config?.base ?? process.env.IMAGE_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
    try {
      const response = await fetch(endpoint + (comfy ? "/system_stats" : "/models"), {
        headers: comfy ? {} : { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000), redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        return reply.code(502).send({ message: `服务返回 HTTP ${response.status}。请检查地址和权限，部分兼容服务不支持模型列表检测。` });
      }
      if (seedream) {
        const result = await response.json() as { data?: { id?: string }[] };
        const visibleModels = Array.isArray(result.data) ? result.data.flatMap(item => item?.id && /^doubao-(?:seedream|seedance)-[\w.-]+$/.test(item.id) ? [item.id] : []) : [];
        return { message: "方舟已通过模型列表鉴权。模型可见性与账号开通状态分别核验。", visibleModels };
      }
      await response.body?.cancel();
      return { message: comfy ? "ComfyUI 服务可达。具体工作流仍取决于已安装的模型和节点。" : "服务鉴权与连接成功。图片模型调用权限需通过实际生成验证。" };
    } catch (error) {
      const cause = error as { name?: string; cause?: { code?: string } };
      const code = cause.cause?.code ?? cause.name ?? "UNKNOWN";
      const hints: Record<string, string> = {
        ENOTFOUND: "域名解析失败，请检查服务地址和 DNS。",
        ECONNREFUSED: "连接被拒绝，请检查服务或代理是否启动。",
        EACCES: "网络访问被系统或运行环境阻止，请检查应用网络权限。",
        ETIMEDOUT: "连接超时，请检查网络、代理和防火墙。",
        UND_ERR_CONNECT_TIMEOUT: "连接超时；浏览器能访问不代表 Node 后端已使用相同代理。",
        TimeoutError: "检测超过 10 秒，请检查后端网络和代理设置。",
        DEPTH_ZERO_SELF_SIGNED_CERT: "证书验证失败，请检查代理证书配置，不要关闭 TLS 校验。",
      };
      return reply.code(502).send({ code, message: hints[code] ?? "服务连接失败，请检查后端网络、代理及证书配置。" });
    }
  });

  async function execute(job: Job, reference?: string, extraReferences: string[] = []) {
    job.state = "running";
    save(job);
    try {
      const { provider, model, size } = job.input;
      const prompt = [job.input.prompt, job.style?.rules].filter(Boolean).join("\n作品风格：");
      const styleReference = job.style?.reference;
      if (provider === "comfyui") {
        const endpoint = (process.env.COMFYUI_URL ?? "http://127.0.0.1:8188").replace(/\/$/, "");
        let referenceName = "";
        let styleReferenceName = "";
        if (reference) {
          const blob = await (await fetch(reference)).blob();
          const form = new FormData();
          form.append("image", blob, `${job.id}.png`);
          const uploaded = await (await checkedFetch(endpoint + "/upload/image", { method: "POST", body: form })).json() as { name: string; subfolder?: string };
          referenceName = uploaded.subfolder ? uploaded.subfolder + "/" + uploaded.name : uploaded.name;
        }
        if (styleReference && styleReference !== reference) {
          const blob = await (await fetch(styleReference)).blob();
          const form = new FormData();
          form.append("image", blob, `${job.id}-style.png`);
          const uploaded = await (await checkedFetch(endpoint + "/upload/image", { method: "POST", body: form })).json() as { name: string; subfolder?: string };
          styleReferenceName = uploaded.subfolder ? uploaded.subfolder + "/" + uploaded.name : uploaded.name;
        }
        const replace = (value: unknown): unknown => {
          if (value === "{{prompt}}") return prompt;
          if (value === "{{image}}") return referenceName;
          if (value === "{{style_image}}") return styleReferenceName;
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
        const ark = seedream ? arkConfig(job.input.ark_profile ?? "standard", "image") : undefined;
        const endpoint = (ark?.base ?? process.env.IMAGE_API_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
        const key = seedream ? ark?.key : process.env.IMAGE_API_KEY;
        if (!key) throw new Error("请配置对应服务的 API Key");
        const editReference = reference ?? styleReference;
        let body: BodyInit;
        const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
        let path = "/images/generations";
        if (editReference && !seedream) {
          const form = new FormData();
          form.append("model", model);
          form.append("prompt", prompt);
          form.append("size", size);
          form.append("n", "1");
          form.append("image", await (await fetch(editReference)).blob(), "reference.png");
          body = form;
          path = "/images/edits";
        } else {
          headers["Content-Type"] = "application/json";
          const refs = job.input.image_mode === "text" ? [] : [...new Set([reference, ...extraReferences, ...(job.input.image_mode ? [] : [editReference])].filter((item): item is string => Boolean(item)))];
          body = JSON.stringify({
            model: seedream ? model.trim() : model, prompt, size: seedream ? size.trim().replace(/k$/i, "K").replace(/^auto$/i, "auto").replace(/X/g, "x") : size,
            ...(seedream ? {
              watermark: false, response_format: "url",
              ...(refs.length ? { image: refs.length === 1 ? refs[0] : refs } : {}),
              ...(job.input.image_mode === "layers" ? { layer_decomposition: true } : {}),
              ...(job.input.transparent_background ? { background: "transparent", output_format: "png" } : {}),
              ...(job.input.group_count ? { sequential_image_generation: "auto", sequential_image_generation_options: { max_images: job.input.group_count } } : {}),
            } : { n: 1 }),
          });
        }
        const result = await (await checkedFetch(endpoint + path, { method: "POST", headers, body })).json() as { data?: { b64_json?: string; url?: string; name?: string; z_index?: number; bounding_box?: unknown; size?: string; error?: { code?: string } }[] };
        const outputLimit = job.input.image_mode === "layers" ? 17 : job.input.group_count ?? 8;
        for (const image of (result.data ?? []).slice(0, outputLimit)) {
          const previousCount = job.outputs.length;
          if (image.b64_json) {
            if (image.b64_json.length > 28 * 1024 * 1024) throw new Error("生成图片超过大小限制");
            job.outputs.push(await imageData(new Response(Buffer.from(image.b64_json, "base64"))));
          } else if (image.url) {
            const url = new URL(image.url);
            if (url.protocol !== "https:") throw new Error("远程图片必须使用 HTTPS");
            job.outputs.push(await imageData(new Response(await downloadMedia(url.href, 20 * 1024 * 1024))));
          }
          if (job.outputs.length > previousCount && job.input.image_mode === "layers") {
            (job.output_details ??= []).push({ name: image.name, z_index: image.z_index, bounding_box: image.bounding_box, size: image.size });
          }
          if (image.error?.code) job.error = "部分候选未生成，方舟错误码：" + image.error.code;
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

  const records = "/v1/projects/:project/image-jobs";
  jobRecordRoutes(app, records, jobs, save, job => [...approving].some(key => key.startsWith(job.id + ":")));
  app.get<{ Params: { project: string }; Querystring: JobRecordQuery }>(records, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    return { items: [...jobs.values()].filter(job => matchesJobRecord(job, request.params.project, request.query)).reverse().map(({ outputs, ...job }) => ({ ...job, output_count: outputs.length })) };
  });
  app.post<{ Params: Params }>(base + "/:job/cancel", async (request, reply) => {
    const job = jobs.get(request.params.job);
    if (!job || job.deleted_at || job.project !== request.params.project || job.character !== request.params.character) return reply.code(404).send({ message: "任务不存在" });
    if (job.state !== "queued") return reply.code(409).send({ message: "任务已提交到服务，不能保证撤销，请等待结果或核对服务记录" });
    job.state = "cancelled"; save(job); return job;
  });
  app.get<{ Params: Params }>(base, async request => ({
    items: [...jobs.values()].filter(job => !job.deleted_at && job.project === request.params.project && job.character === request.params.character).reverse(),
  }));
  app.post<{ Params: Params }>(base, async (request, reply) => {
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "生成参数无效" });
    const input = parsed.data;
    if (input.provider === "openai" && !process.env.IMAGE_API_KEY) return reply.code(400).send({ message: "缺少 IMAGE_API_KEY，请配置后重启" });

    const prior = jobs.get(input.request_id);
    if (prior) {
      if (prior.project !== request.params.project || prior.character !== request.params.character || JSON.stringify(prior.input) !== JSON.stringify(input)) return reply.code(409).send({ message: "请求编号已被使用" });
      if (prior.deleted_at) return reply.code(409).send({ message: "此任务已移入回收站，可在任务中心恢复。" });
      return prior;
    }
    if (input.provider === "seedream") {
      const profile = input.ark_profile ?? "standard";
      const config = arkService(profile, "image");
      if (!config.configured) return reply.code(400).send({ message: config.error ?? "请配置对应的 ARK_API_KEY 或 ARK_PLAN_API_KEY 后重启。" });
      const issue = arkModelIssue(input.model.trim(), profile, "image");
      if (issue) return reply.code(400).send({ message: issue });
    } else if (input.ark_profile || input.image_mode || input.reference_ids || input.group_count || input.transparent_background) {
      return reply.code(400).send({ message: "这些图片处理选项仅用于方舟 Seedream。" });
    }
    if (!(await repository.characters(request.params.project)).some(c => c.id === request.params.character)) return reply.code(404).send({ message: "角色不存在" });
    if (input.provider === "comfyui" ? !input.workflow || !Object.values(input.workflow).every(node => node && typeof node === "object" && "class_type" in node && "inputs" in node) : !input.model.trim()) return reply.code(400).send({ message: "请填写模型 ID 或导入 ComfyUI API 格式工作流" });
    const reference = input.reference_id ? (await repository.references(request.params.project, request.params.character)).find(image => image.id === input.reference_id) : undefined;
    if (input.reference_id && !reference) return reply.code(400).send({ message: "参考图不存在" });
    let extraReferences: string[] = [];
    if (input.provider === "seedream") {
      const capability = arkImageCapability(input.model.trim(), input.ark_profile ?? "standard");
      const allIds = [...new Set(input.reference_ids ?? [])].filter(id => id !== input.reference_id);
      if (allIds.length) {
        const assets = await repository.references(request.params.project, request.params.character);
        extraReferences = allIds.map(id => assets.find(asset => asset.id === id)?.data_url ?? "");
        if (extraReferences.some(item => !item)) return reply.code(400).send({ message: "部分参考图不存在或不属于当前素材对象。" });
      }
      const refs = [...(reference ? [reference.data_url] : []), ...extraReferences];
      if (input.image_mode === "text" && refs.length || input.image_mode === "reference" && !refs.length) return reply.code(400).send({ message: "请按所选模式配置参考图。" });
      if (refs.length > capability.maxReferences) return reply.code(400).send({ message: `当前模型最多支持 ${capability.maxReferences} 张参考图。` });
      if (input.image_mode === "layers" && (!capability.layers || refs.length !== 1 || !/^data:image\/(?:png|jpeg);base64,/.test(refs[0]!) || input.group_count)) {
        return reply.code(400).send({ message: "图层拆分需要支持此能力的模型和一张 PNG/JPEG，不能同时生成组图。" });
      }
      if (input.group_count && (!capability.group || input.group_count + refs.length > 15 || !input.image_mode)) {
        return reply.code(400).send({ message: "当前模式不支持组图，或参考图与组图数量之和超过 15 张。" });
      }
      if (input.transparent_background && (!capability.layers || input.image_mode !== "reference" || refs.length !== 1 || input.group_count)) {
        return reply.code(400).send({ message: "透明图生图需要支持此能力的模型和一张带透明通道的参考图。" });
      }
      if (input.image_mode && refs.length) {
        try {
          for (const dataUrl of refs) {
            const image = arkLocalImage(dataUrl);
            if (image.width <= 14 || image.height <= 14 || image.ratio < 1 / 16 || image.ratio > 16 || image.width * image.height > 36000000) {
              throw new Error("参考图不符合方舟尺寸要求，请检查边长、宽高比和总像素数。");
            }
            if (input.image_mode === "layers" && image.width * image.height < 512 * 512) throw new Error("图层拆分的参考图至少需 262144 像素。");
            if (input.transparent_background && !image.alpha) throw new Error("参考图需要包含透明通道。");
          }
        } catch (error) { return reply.code(400).send({ message: (error as Error).message }); }
      }
      const size = input.size.trim().toUpperCase();
      const pixels = /^(\d+)X(\d+)$/.exec(size);
      if (capability.known && pixels && input.image_mode !== "layers") {
        const width = Number(pixels[1]), height = Number(pixels[2]);
        const minPixels = capability.sizes.includes("1K") ? 1280 * 720 : 2560 * 1440;
        const maxPixels = capability.layers ? 4624220 : 4096 * 4096;
        if (width * height < minPixels || width * height > maxPixels || width / height < 1 / 16 || width / height > 16) {
          return reply.code(400).send({ message: "自定义分辨率超出当前模型的总像素或宽高比范围。" });
        }
      } else if (capability.known && !capability.sizes.includes(size) && !(input.image_mode === "layers" && size === "AUTO")) {
        return reply.code(400).send({ message: `当前模型支持的分辨率档位：${capability.sizes.join("、")}` });
      }
      if (refs.reduce((bytes, item) => bytes + item.length, 0) > 60 * 1024 * 1024) return reply.code(400).send({ message: "参考图编码后的总大小超过应用上限 60MB。" });
    }
    if (pending.length >= 20) return reply.code(429).send({ message: "等待队列已满，请稍后提交" });
    const job: Job = { id: input.request_id, project: request.params.project, character: request.params.character, input, state: "queued", outputs: [], approved: {}, created_at: new Date().toISOString() };
    if (db.prepare("SELECT name FROM sqlite_master WHERE name='studio_records'").get()) {
      const row = db.prepare("SELECT payload FROM studio_records WHERE project=? AND kind='styles' ORDER BY rowid DESC LIMIT 1").get(job.project);
      if (row) {
        const style = JSON.parse(String(row.payload));
        job.style = { id: style.id, rules: style.rules, reference_id: style.reference_id };
        if (style.reference_id) {
          for (const character of await repository.characters(job.project)) {
            const anchor = (await repository.references(job.project, character.id)).find(image => image.id === style.reference_id);
            if (anchor) { job.style.reference = anchor.data_url; break; }
          }
        }
      }
    }
    const raced = jobs.get(input.request_id);
    if (raced) return !raced.deleted_at && raced.project === request.params.project && raced.character === request.params.character && JSON.stringify(raced.input) === JSON.stringify(input) ? raced : reply.code(409).send({ message: "请求编号已被使用" });
    try { reserveUsage(db, input.request_id, request.params.project, "image", input.group_count ?? (input.image_mode === "layers" ? 17 : 1)); }
    catch(e) { return reply.code(429).send({ message: e instanceof Error ? e.message : "用量预留失败" }); }
    save(job);
    pending.push({ job, reference: reference?.data_url, extraReferences });
    drain();
    return reply.code(202).send(job);
  });
  app.post<{ Params: Params; Body: { index: number } }>(base + "/:job/approve", async (request, reply) => {
    const job = jobs.get(request.params.job);
    const index = request.body?.index;
    if (!job || job.deleted_at || job.project !== request.params.project || job.character !== request.params.character || !Number.isInteger(index) || !job.outputs[index]) return reply.code(404).send({ message: "候选不存在" });
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

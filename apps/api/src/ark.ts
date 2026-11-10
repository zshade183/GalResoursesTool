export type ArkProfile = "standard" | "agent-plan";
const standardBase = "https://ark.cn-beijing.volces.com/api/v3";
const planBase = "https://ark.cn-beijing.volces.com/api/plan/v3";

export function arkConfig(profile: ArkProfile, media: "image" | "video") {
  if (profile === "agent-plan") {
    return {
      base: planBase,
      key: process.env.ARK_PLAN_API_KEY?.trim() || process.env.AGENT_API_KEY?.trim(),
      model: process.env[media === "image" ? "ARK_PLAN_IMAGE_MODEL" : "ARK_PLAN_VIDEO_MODEL"]?.trim(),
    };
  }
  const base = (process.env.ARK_BASE_URL?.trim() || process.env.SEEDREAM_BASE_URL?.trim() || standardBase).replace(/\/+$/, "");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/api/v3")) {
    throw new Error("普通方舟地址应为 HTTPS 的 /api/v3 基础地址。Agent Plan 请选专属配置。");
  }
  return {
    base,
    key: process.env.ARK_API_KEY?.trim() || process.env.SEEDREAM_API_KEY?.trim(),
    model: process.env[media === "image" ? "ARK_IMAGE_MODEL" : "ARK_VIDEO_MODEL"]?.trim(),
  };
}

export function arkService(profile: ArkProfile, media: "image" | "video") {
  try {
    const config = arkConfig(profile, media);
    return { configured: Boolean(config.key), model: config.model, error: undefined };
  } catch (error) {
    return { configured: false, model: undefined, error: (error as Error).message };
  }
}

export const arkImageModels = {
  standard: ["doubao-seedream-5-0-flash-260915", "doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-260128", "doubao-seedream-4-5-251128", "doubao-seedream-4-0-250828"],
  "agent-plan": ["doubao-seedream-5.0-flash", "doubao-seedream-5.0-pro", "doubao-seedream-5-0-pro"],
};

export function arkImageCapability(model: string, profile: ArkProfile) {
  const id = model.startsWith("ep-") && model === process.env.ARK_IMAGE_MODEL?.trim() && profile === "standard"
    ? process.env.ARK_IMAGE_CAPABILITY_MODEL?.trim() ?? model : model;
  const modern = /^doubao-seedream-(?:5-0-(?:flash|pro)-\d{6}|5\.0-(?:flash|pro)|5-0-pro)$/.test(id);
  const lite = /^doubao-seedream-(?:5-0-(?:lite-)?260128|5\.0-lite)$/.test(id);
  const older = /^doubao-seedream-4-[05]-\d{6}$/.test(id);
  return {
    known: modern || lite || older,
    maxReferences: modern ? 10 : lite || older ? 14 : 1,
    group: lite || older,
    layers: modern,
    sizes: modern ? ["1K", "1.5K", "2K"] : lite ? ["2K", "3K", "4K"] : id.startsWith("doubao-seedream-4-5-") ? ["2K", "4K"] : older ? ["1K", "2K", "4K"] : [],
  };
}

export const arkVideoModels = {
  standard: ["doubao-seedance-2-5-260628", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615", "doubao-seedance-1-0-pro-250528", "doubao-seedance-1-0-pro-fast-251015"],
  "agent-plan": ["doubao-seedance-2.5", "doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-mini"],
};

export function arkVideoCapability(model: string, profile: ArkProfile) {
  const id = model.startsWith("ep-") && model === process.env.ARK_VIDEO_MODEL?.trim() && profile === "standard"
    ? process.env.ARK_VIDEO_CAPABILITY_MODEL?.trim() ?? model : model;
  const family = /^doubao-seedance-(?:2-5-\d{6}|2\.5)$/.test(id) ? "2.5"
    : /^doubao-seedance-(?:2-0-(?:fast-|mini-)?\d{6}|2\.0(?:-fast|-mini)?)$/.test(id) ? "2.0"
    : /^doubao-seedance-1-0-pro-(?:fast-)?\d{6}$/.test(id) ? "1.0" : undefined;
  if (!family) return undefined;
  const limited = /-(?:fast|mini)(?:-|$)/.test(id);
  return {
    family,
    durationMin: family === "1.0" ? 2 : 4,
    durationMax: family === "2.5" ? 30 : family === "2.0" ? 15 : 12,
    resolutions: family === "2.0" ? limited ? ["480p", "720p"] : ["480p", "720p", "1080p", "4k"] : ["480p", "720p", "1080p"],
    modes: family === "2.5" ? ["text", "first", "frames", "reference", "edit", "extend"]
      : family === "2.0" ? ["text", "first", "frames", "reference"]
      : limited ? ["text", "first"] : ["text", "first", "frames"],
    maxImages: family === "2.5" ? 30 : family === "2.0" ? 9 : 0,
    maxVideos: family === "2.5" ? 10 : family === "2.0" ? 3 : 0,
    audio: family !== "1.0",
  };
}

export function arkModelIssue(model: string, profile: ArkProfile, media: "image" | "video") {
  if (/^apikey-/i.test(model)) return "模型栏里填的是 API Key 名称，请填写模型 ID 或接入点 ID。";
  if (/^(?:ark-)?[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}(?:-[\da-z]+)?$/i.test(model)) return "模型栏需要模型 ID 或接入点 ID，请将 API Key 配置在后端。";
  if (media === "image" && /^(?:doubao-)?seedance(?:[.-]|$)/i.test(model)) return "Seedance 用于生成视频。图片生成请填已开通的 Seedream 模型 ID，或对应的 ep- 接入点 ID。";
  if (media === "video" && /^(?:doubao-)?seedream(?:[.-]|$)/i.test(model)) return "Seedream 用于生成图片。视频请选择 Seedance 模型。";
  if (profile === "agent-plan" && !(media === "image" ? arkImageModels : arkVideoModels)["agent-plan"].includes(model)) {
    return "请填写 Agent Plan 支持的套餐模型 ID，或切换到普通方舟。";
  }
  if (profile === "standard" && (/^doubao-(?:seedance|seedream)-\d\.\d/.test(model) || model === "doubao-seedream-5-0-pro")) return "此模型 ID 使用套餐格式，请切换至 Agent Plan 或填写普通方舟模型 ID。";
}

export function arkVideoPath(id?: string) {
  return "/contents/generations/tasks" + (id ? "/" + encodeURIComponent(id) : "");
}

export function arkHeaders(key: string) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

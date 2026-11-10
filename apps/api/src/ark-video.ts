import { z } from "zod";
import { arkVideoCapability } from "./ark.js";

const source = z.object({ character_id: z.string().min(1), reference_id: z.string().min(1) }).strict();
const mediaUrl = z.string().trim().max(4000).refine(value => {
  if (/^asset:\/\/[\w-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch { return false; }
}, "素材必须是 HTTPS 链接或方舟 asset:// 素材 ID");

export const arkVideoInput = z.object({
  provider: z.literal("seedance"),
  ark_profile: z.enum(["standard", "agent-plan"]),
  model: z.string().trim().min(1).max(200),
  mode: z.enum(["text", "first", "frames", "reference", "edit", "extend"]),
  request_id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(850),
  camera: z.enum(["fixed", "moving"]),
  duration: z.number().int().min(-1).max(30),
  ratio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"]),
  resolution: z.enum(["480p", "720p", "1080p", "4k"]),
  loop_intent: z.boolean(),
  generate_audio: z.boolean(),
  first_frame: source.optional(),
  last_frame: source.optional(),
  reference_images: z.array(source).max(30).optional(),
  image_urls: z.array(mediaUrl).max(30).optional(),
  video_urls: z.array(mediaUrl).max(10).optional(),
  audio_urls: z.array(mediaUrl).max(10).optional(),
}).strict();

type Input = z.infer<typeof arkVideoInput>;
export function arkVideoIssue(input: Input, capability: NonNullable<ReturnType<typeof arkVideoCapability>>) {
  const { mode, duration, ratio, first_frame, last_frame } = input;
  const images = (input.reference_images?.length ?? 0) + (input.image_urls?.length ?? 0);
  const videos = input.video_urls?.length ?? 0;
  const audio = input.audio_urls?.length ?? 0;
  if (!capability.modes.includes(mode)) return "当前模型不支持所选视频模式。";
  if (!capability.resolutions.includes(input.resolution)) return "当前模型不支持所选分辨率。";
  if (input.generate_audio && !capability.audio) return "当前模型不支持生成同步音频。";
  if (!(duration === -1 && capability.family !== "1.0") && (duration < capability.durationMin || duration > capability.durationMax)) {
    return `当前模型支持 ${capability.durationMin} 至 ${capability.durationMax} 秒。`;
  }
  const usesFrames = mode === "first" || mode === "frames";
  if (Boolean(first_frame) !== usesFrames || Boolean(last_frame) !== (mode === "frames")) return "请按所选模式添加首帧或首尾帧。";
  if ((mode === "text" || usesFrames) && images + videos + audio) return "文生视频、首尾帧和参考素材模式不能混用。";
  if (capability.family === "1.0" && mode === "text" && ratio === "adaptive") return "Seedance 1.0 文生视频需要指定画幅。";
  if (capability.family === "2.5" && (usesFrames || mode === "edit" || mode === "extend") && ratio !== "adaptive") return "Seedance 2.5 的首尾帧、视频编辑与延长仅支持自适应画幅。";
  if (images > capability.maxImages || videos > capability.maxVideos || audio > capability.maxVideos) return "参考素材数量超过当前模型上限。";
  if (mode === "reference" && images + videos + (capability.family === "2.5" ? audio : 0) === 0) return "请添加该模型支持的参考素材。";
  if ((mode === "edit" || mode === "extend") && !videos) return "视频编辑和延长需要参考视频。";
  if (mode === "edit" && duration !== -1) return "视频编辑必须使用自动时长。";
}

export function arkVideoBody(input: Input, prompt: string, frames: { first?: string; last?: string; references: string[] }) {
  const image = (url: string, role: string) => ({ type: "image_url", image_url: { url }, role });
  return {
    model: input.model,
    content: [
      { type: "text", text: prompt },
      ...(frames.first ? [image(frames.first, "first_frame")] : []),
      ...(frames.last ? [image(frames.last, "last_frame")] : []),
      ...[...frames.references, ...(input.image_urls ?? [])].map(url => image(url, "reference_image")),
      ...(input.video_urls ?? []).map(url => ({ type: "video_url", video_url: { url }, role: "reference_video" })),
      ...(input.audio_urls ?? []).map(url => ({ type: "audio_url", audio_url: { url }, role: "reference_audio" })),
    ],
    ratio: input.ratio,
    duration: input.duration,
    resolution: input.resolution,
    watermark: false,
    ...(arkVideoCapability(input.model, input.ark_profile)?.audio ? { generate_audio: input.generate_audio } : {}),
    ...(arkVideoCapability(input.model, input.ark_profile)?.family === "2.5" && ["reference", "edit", "extend"].includes(input.mode)
      ? { omni_reference_task_type: input.mode } : {}),
  };
}

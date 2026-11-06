import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "./projects.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export function musicRoutes(app: FastifyInstance, repository: ProjectRepository) {
  const route = "/v1/projects/:project/music";
  app.get<{ Params: { project: string } }>(route, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    return { items: (await repository.music(request.params.project)).map(({ data, ...metadata }) => ({ ...metadata, bytes: Buffer.from(data, "base64").length })) };
  });
  app.post<{ Params: { project: string } }>(route, { bodyLimit: 29 * 1024 * 1024 }, async (request, reply) => {
    if (!await repository.get(request.params.project)) return reply.code(404).send({ message: "作品不存在" });
    const parsed = z.object({ parent_id: z.string().uuid().optional(), loop_start: z.number().min(0).optional(), loop_end: z.number().positive().optional(), loop_verified: z.boolean().optional(), name: z.string().trim().min(1).max(200), purpose: z.enum(["bgm", "ambience", "sfx"]), source: z.string().trim().min(1).max(2000), data: z.string().max(28 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "请填写名称和来源，并选择 WAV、MP3 或 OGG 文件" });
    if (parsed.data.parent_id && !(await repository.music(request.params.project)).some(item => item.id === parsed.data.parent_id)) return reply.code(400).send({ message: "来源音频不存在" });
    if ((parsed.data.loop_start === undefined) !== (parsed.data.loop_end === undefined) || parsed.data.loop_end !== undefined && parsed.data.loop_end <= parsed.data.loop_start!) return reply.code(400).send({ message: "循环点无效" });
    const bytes = Buffer.from(parsed.data.data, "base64");
    if (bytes.length > 20 * 1024 * 1024 || bytes.length < 12) return reply.code(400).send({ message: "文件为空或超过 20MB" });
    const mime = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE" ? "audio/wav"
      : bytes.toString("ascii", 0, 4) === "OggS" ? "audio/ogg"
      : bytes.toString("ascii", 0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0) ? "audio/mpeg" : undefined;
    if (!mime) return reply.code(400).send({ message: "无法识别音频格式" });
    const item = { id: randomUUID(), project_id: request.params.project, ...parsed.data, mime, created_at: new Date().toISOString() };
    await repository.addMusic(item);
    return reply.code(201).send({ id: item.id });
  });
  app.get<{ Params: { project: string; id: string } }>(route + "/:id/file", async (request, reply) => {
    const item = (await repository.music(request.params.project)).find(item => item.id === request.params.id);
    if (!item) return reply.code(404).send({ message: "音频不存在" });
    return reply.header("Cache-Control", "private, max-age=3600").type(item.mime).send(Buffer.from(item.data, "base64"));
  });
}

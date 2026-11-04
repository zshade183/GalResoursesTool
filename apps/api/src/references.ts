import type { FastifyInstance } from "fastify";
import type { ProjectRepository } from "./projects.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

type Params = { id: string; characterId: string };
export function referenceRoutes(app: FastifyInstance, repository: ProjectRepository) {
  const url = "/v1/projects/:id/characters/:characterId/references";
  const exists = async (params: Params) => (await repository.characters(params.id)).some(c => c.id === params.characterId);
  app.get<{ Params: Params }>(url, async (request, reply) => {
    if (!await exists(request.params)) return reply.code(404).send({ message: "角色不存在" });
    return { items: await repository.references(request.params.id, request.params.characterId), standard_id: await repository.standardReference(request.params.id, request.params.characterId) };
  });
  app.post<{ Params: Params }>(url, { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    if (!await exists(request.params)) return reply.code(404).send({ message: "角色不存在" });
    const result = z.object({ name: z.string().trim().min(1).max(255), source: z.string().trim().min(1).max(2000), data_url: z.string().max(7 * 1024 * 1024) }).strict().safeParse(request.body);
    if (!result.success) return reply.code(400).send({ message: "请填写文件名和来源，并选择不超过 5MB 的图片。" });
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(result.data.data_url);
    if (!match) return reply.code(400).send({ message: "仅支持 PNG、JPEG、WebP 图片" });
    const bytes = Buffer.from(match[2]!, "base64");
    const valid = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
    if (!valid || bytes.length > 5 * 1024 * 1024) return reply.code(400).send({ message: "图片格式与内容不符，或超过 5MB。" });
    const image = { id: randomUUID(), project_id: request.params.id, character_id: request.params.characterId, ...result.data, created_at: new Date().toISOString() };
    await repository.addReference(image);
    return reply.code(201).send(image);
  });
  app.put<{ Params: Params }>(`${url}/standard`, async (request, reply) => {
    const input = z.object({ image_id: z.string().uuid() }).strict().safeParse(request.body);
    if (!input.success) return reply.code(400).send({ message: "请选择参考图" });
    if (!await exists(request.params) || !(await repository.references(request.params.id, request.params.characterId)).some(i => i.id === input.data.image_id)) return reply.code(404).send({ message: "参考图不存在" });
    return { standard_id: await repository.standardReference(request.params.id, request.params.characterId, input.data.image_id) };
  });
}

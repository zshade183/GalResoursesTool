import cors from "@fastify/cors";
import type { HealthResponse } from "@gal/contracts";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { memoryProjects, type ProjectRepository } from "./projects.js";
import { referenceRoutes } from "./references.js";
import { musicRoutes } from "./music.js";

export function buildApp(projects: ProjectRepository = memoryProjects()) {
  const app = Fastify({ logger: true });
  referenceRoutes(app, projects);
  musicRoutes(app, projects);
  const characterInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(20000), kind: z.enum(["character", "scene", "image"]).optional() }).strict();
  app.get<{ Params: { id: string; characterId: string } }>("/v1/projects/:id/characters/:characterId/history", async (request, reply) => {
    if (!(await projects.characters(request.params.id)).some(c => c.id === request.params.characterId)) return reply.code(404).send({ message: "角色不存在" });
    return { items: await projects.history(request.params.id, request.params.characterId) };
  });
  app.get<{ Params: { id: string } }>("/v1/projects/:id/characters", async (request, reply) => {
    if (!await projects.get(request.params.id)) return reply.code(404).send({ message: "作品不存在" });
    return { items: await projects.characters(request.params.id) };
  });
  for (const method of ["POST", "PUT"] as const) {
    app.route<{ Params: { id: string; characterId?: string } }>({
      method, url: method === "POST" ? "/v1/projects/:id/characters" : "/v1/projects/:id/characters/:characterId",
      async handler(request, reply) {
        const input = characterInput.safeParse(request.body);
        if (!input.success) return reply.code(400).send({ message: "请填写角色名称，设定不能超过两万字。" });
        if (!await projects.get(request.params.id)) return reply.code(404).send({ message: "作品不存在" });
        if (method === "PUT" && !(await projects.characters(request.params.id)).some(c => c.id === request.params.characterId)) return reply.code(404).send({ message: "角色不存在" });
        const existing = request.params.characterId ? (await projects.characters(request.params.id)).find(c => c.id === request.params.characterId) : undefined;
        const character = await projects.saveCharacter({ id: request.params.characterId ?? randomUUID(), project_id: request.params.id, ...input.data, kind: input.data.kind ?? existing?.kind ?? "character", updated_at: new Date().toISOString() });
        return reply.code(method === "POST" ? 201 : 200).send(character);
      },
    });
  }
  const createProject = z.object({ name: z.string().trim().min(1).max(120) }).strict();

  app.get("/v1/projects", async () => ({ items: await projects.list() }));
  app.post("/v1/projects", async (request, reply) => {
    const parsed = createProject.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: "INVALID_INPUT", message: "作品名称需为 1 至 120 个字符", retryable: false, request_id: request.id });
    }
    const project = { id: randomUUID(), name: parsed.data.name, created_at: new Date().toISOString() };
    await projects.create(project);
    return reply.code(201).send(project);
  });
  app.get<{ Params: { id: string } }>("/v1/projects/:id", async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(404).send({ code: "NOT_FOUND", message: "作品不存在" });
    const project = await projects.get(request.params.id);
    if (!project) return reply.code(404).send({ code: "NOT_FOUND", message: "作品不存在", retryable: false, request_id: request.id });
    return project;
  });

  app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? false : true,
  });

  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
  }));

  return app;
}


import { expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { generationRoutes } from "./generation.js";
import { memoryProjects } from "./projects.js";
import { randomUUID } from "node:crypto";

it("reports missing credentials and rejects a paid request before creating a job", async () => {
  vi.stubEnv("IMAGE_API_KEY", "");
  vi.stubEnv("SEEDREAM_API_KEY", "");
  const repository = memoryProjects();
  const app = buildApp(repository);
  generationRoutes(app, repository, ":memory:");
  try {
    const status = await app.inject({ method: "GET", url: "/v1/image-services" });
    expect(status.json()).toMatchObject({ openai: false, seedream: false });
    const url = "/v1/projects/p/characters/c/generation";
    const response = await app.inject({ method: "POST", url, payload: {
      request_id: randomUUID(), provider: "openai", prompt: "test", model: "test",
    } });
    expect(response.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url })).json().items).toEqual([]);
  } finally {
    await app.close();
    vi.unstubAllEnvs();
  }
});

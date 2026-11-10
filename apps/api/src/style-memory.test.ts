import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { generationRoutes } from "./generation.js";
import { studioRoutes } from "./studio.js";
import { memoryProjects } from "./projects.js";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function tempDb() { return join(tmpdir(), `style-memory-${randomUUID()}.sqlite`); }
function cleanup(path: string) { rmSync(path, { force: true }); rmSync(path + "-wal", { force: true }); rmSync(path + "-shm", { force: true }); }

it("saves a style anchor only when the referenced image exists in the project", async () => {
  const repo = memoryProjects();
  await repo.create({ id: "p", name: "P", created_at: "now" });
  await repo.saveCharacter({ id: "c", project_id: "p", name: "Hero", description: "", updated_at: "now" });
  const anchorId = randomUUID();
  await repo.addReference({ id: anchorId, project_id: "p", character_id: "c", name: "style", source: "owned", data_url: "data:image/png;base64," + png, created_at: "now" });
  const app = buildApp(repo);
  const db = tempDb();
  studioRoutes(app, repo, db);
  try {
    const url = "/v1/projects/p/studio/records/styles";
    const base = { name: "s", rules: "flat pastel", width: 1920, height: 1080 };
    // A reference that does not exist is rejected.
    expect((await app.inject({ method: "POST", url, payload: { ...base, reference_id: randomUUID() } })).statusCode).toBe(400);
    // A valid reference is accepted and persisted with the anchor.
    expect((await app.inject({ method: "POST", url, payload: { ...base, reference_id: anchorId } })).statusCode).toBe(201);
    const items = (await app.inject({ method: "GET", url: "/v1/projects/p/studio/records/styles" })).json().items;
    expect(items[0].reference_id).toBe(anchorId);
    // Omitting the anchor is still allowed (text-only style).
    expect((await app.inject({ method: "POST", url, payload: base })).statusCode).toBe(201);
  } finally { await app.close(); cleanup(db); }
});

it("injects the project style anchor as the image-to-image reference when no master exists", async () => {
  vi.stubEnv("IMAGE_API_KEY", "test");
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    requests.push(String(url));
    return Response.json({ data: [{ b64_json: png }] });
  }));
  const repo = memoryProjects();
  await repo.create({ id: "p", name: "P", created_at: "now" });
  await repo.saveCharacter({ id: "c", project_id: "p", name: "Hero", description: "", updated_at: "now" });
  const anchorId = randomUUID();
  await repo.addReference({ id: anchorId, project_id: "p", character_id: "c", name: "style", source: "owned", data_url: "data:image/png;base64," + png, created_at: "now" });
  const db = tempDb();
  const app = buildApp(repo);
  studioRoutes(app, repo, db);
  generationRoutes(app, repo, db);
  try {
    await app.inject({ method: "POST", url: "/v1/projects/p/studio/records/styles", payload: { name: "s", rules: "flat pastel", width: 1920, height: 1080, reference_id: anchorId } });
    const url = "/v1/projects/p/characters/c/generation";
    const payload = { request_id: randomUUID(), provider: "openai", prompt: "test", model: "test-model" };
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(202);
    await vi.waitFor(async () => {
      const items = (await app.inject({ method: "GET", url })).json().items;
      expect(items[0].state).toBe("awaiting_review");
    });
    // OpenAI must hit the edits endpoint because the anchor became the reference.
    expect(requests.some(path => path.endsWith("/images/edits"))).toBe(true);
    expect(requests.some(path => path.endsWith("/images/generations"))).toBe(false);
  } finally { await app.close(); cleanup(db); }
});

import { afterEach, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { generationRoutes } from "./generation.js";
import { memoryProjects } from "./projects.js";
import { randomUUID } from "node:crypto";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

it.each([
  ["doubao-seedance-2-5-260628", "Seedance 用于生成视频"],
  ["apikey-example", "API Key 名称"],
])("rejects %s before submitting a Seedream image job", async (model, message) => {
  vi.stubEnv("SEEDREAM_API_KEY", "test");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const repository = memoryProjects();
  const app = buildApp(repository);
  generationRoutes(app, repository, ":memory:");
  try {
    const url = "/v1/projects/project/characters/character/generation";
    const response = await app.inject({
      method: "POST", url,
      payload: { request_id: randomUUID(), provider: "seedream", prompt: "test", model, size: "2K" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain(message);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});

it.each(["openai", "seedream", "comfyui"])("submits %s and persists a reviewed output", async provider => {
  vi.stubEnv("IMAGE_API_KEY", "test");
  vi.stubEnv("SEEDREAM_API_KEY", "test");
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    requests.push(String(url));
    if (String(url).endsWith("/prompt")) return Response.json({ prompt_id: "prompt-1" });
    if (String(url).includes("/history/")) return Response.json({ "prompt-1": { status: { completed: true }, outputs: { "1": { images: [{ filename: "test.png", subfolder: "", type: "output" }] } } } });
    if (String(url).includes("/view?")) return new Response(Buffer.from(png, "base64"));
    expect(JSON.parse(String(options?.body)).model).toBe("test-model");
    return Response.json({ data: [{ b64_json: png }] });
  }));
  const repository = memoryProjects();
  await repository.create({ id: "project", name: "Test", created_at: new Date().toISOString() });
  await repository.saveCharacter({ id: "character", project_id: "project", name: "Test", description: "", updated_at: new Date().toISOString() });
  const app = buildApp(repository);
  generationRoutes(app, repository, ":memory:");
  const url = "/v1/projects/project/characters/character/generation";
  try {
    const requestId = randomUUID();
    const payload = { request_id: requestId, provider, prompt: "test", model: "test-model", workflow: { "1": { class_type: "SaveImage", inputs: {} } } };
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(202);
    await vi.waitFor(async () => {
      const items = (await app.inject({ method: "GET", url })).json().items;
      expect(items[0].state).toBe("awaiting_review");
    });
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(200);
    const first = await app.inject({ method: "POST", url: url + "/" + requestId + "/approve", payload: { index: 0 } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: url + "/" + requestId + "/approve", payload: { index: 0 } });
    expect(second.json().id).toBe(first.json().id);
    expect(await repository.references("project", "character")).toHaveLength(1);
    expect(requests.some(path => path.includes(provider === "comfyui" ? "/prompt" : "/images/generations"))).toBe(true);

    const records = "/v1/projects/project/image-jobs";
    const record = records + "/" + requestId;
    expect((await app.inject({ method: "DELETE", url: record.replace("/project/", "/other/") })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: record })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url })).json().items).toEqual([]);
    expect((await app.inject({ method: "GET", url: records + "?trash=1" })).json().items[0]).toMatchObject({ id: requestId, deleted_at: expect.any(String) });
    expect(await repository.references("project", "character")).toHaveLength(1);
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: record + "/restore" })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url })).json().items[0]).toMatchObject({ id: requestId, state: "approved" });
  } finally { await app.close(); }
});
it("queues batch items, cancels unsubmitted work and deduplicates concurrent requests", async () => {
  vi.stubEnv("IMAGE_API_KEY", "test");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests = vi.fn(async () => { await gate; return Response.json({ data: [{ b64_json: png }] }); });
  vi.stubGlobal("fetch", requests);
  const repository = memoryProjects();
  await repository.create({ id: "p", name: "p", created_at: "now" });
  await repository.saveCharacter({ id: "c", project_id: "p", name: "c", description: "", updated_at: "now" });
  const app = buildApp(repository); generationRoutes(app, repository, ":memory:");
  const url = "/v1/projects/p/characters/c/generation";
  const payload = { request_id: randomUUID(), provider: "openai", prompt: "test", model: "test-model" };
  try {
    const duplicate = await Promise.all([app.inject({ method: "POST", url, payload }), app.inject({ method: "POST", url, payload })]);
    expect(duplicate.map(r => r.statusCode).sort()).toEqual([200, 202]);
    await app.inject({ method: "POST", url, payload: { ...payload, request_id: randomUUID() } });
    const third = randomUUID(); await app.inject({ method: "POST", url, payload: { ...payload, request_id: third } });
    expect(requests).toHaveBeenCalledTimes(2);
    expect((await app.inject({ method: "POST", url: `${url}/${third}/cancel` })).json().state).toBe("cancelled");
    release();
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url })).json().items.filter((job: { state: string }) => job.state === "awaiting_review")).toHaveLength(2));
    expect(requests).toHaveBeenCalledTimes(2);
  } finally { release(); await app.close(); }
});

import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { memoryProjects } from "./projects.js";
import { audioGenerationRoutes } from "./audio-generation.js";
import { conversationRoutes } from "./conversations.js";
import { studioRoutes } from "./studio.js";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() { const repo = memoryProjects(); await repo.create({ id: "p", name: "P", created_at: "now" }); await repo.saveCharacter({ id: "c", project_id: "p", name: "Hero", description: "SECRET_NOT_FOR_MODEL", updated_at: "now" }); const app = buildApp(repo); return { app, repo }; }
it("audio generation persists candidates and approval is idempotent", async () => {
  const { app, repo } = await setup(); audioGenerationRoutes(app, repo, ":memory:"); vi.stubEnv("ELEVENLABS_API_KEY", "test");
  const request = vi.fn(async () => new Response(Buffer.from("ID3audio-fixture"))); vi.stubGlobal("fetch", request);
  const payload = { request_id: randomUUID(), name: "Rain", purpose: "sfx", prompt: "rain on window", duration: 5, instrumental: true, loop: true };
  try { expect((await app.inject({ method: "POST", url: "/v1/projects/p/audio-jobs", payload })).statusCode).toBe(202);
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: "/v1/projects/p/audio-jobs" })).json().items[0].state).toBe("awaiting_review"));
    await app.inject({ method: "POST", url: "/v1/projects/p/audio-jobs", payload }); expect(request).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2; i++) expect((await app.inject({ method: "POST", url: `/v1/projects/p/audio-jobs/${payload.request_id}/approve` })).statusCode).toBe(200);
    expect(await repo.music("p")).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: `/v1/projects/other/audio-jobs/${payload.request_id}/file` })).statusCode).toBe(404);
    const record = `/v1/projects/p/audio-jobs/${payload.request_id}`;
    expect((await app.inject({ method: "DELETE", url: record })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/audio-jobs" })).json().items).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/audio-jobs?trash=1" })).json().items[0].id).toBe(payload.request_id);
    expect(await repo.music("p")).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: record + "/restore" })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/audio-jobs" })).json().items[0].approved).toBe(true);
  } finally { await app.close(); }
});
it("conversation uses only explicit branch facts and never includes full character secrets", async () => {
  const { app, repo } = await setup(); conversationRoutes(app, repo, ":memory:"); vi.stubEnv("OLLAMA_MODEL", "test-model");
  const request = vi.fn(async (_url: string, options: RequestInit) => { const input = String(options.body); expect(input).toContain("known_fact"); expect(input).not.toContain("SECRET_NOT_FOR_MODEL"); return Response.json({ message: { content: "Suggestion" } }); }); vi.stubGlobal("fetch", request);
  try { const session = (await app.inject({ method: "POST", url: "/v1/projects/p/conversations", payload: { character: "c", branch: "A", facts: "known_fact" } })).json();
    const payload = { request_id: randomUUID(), message: "What next?" }, url = `/v1/projects/p/conversations/${session.id}/messages`;
    expect((await app.inject({ method: "POST", url, payload })).json().messages).toHaveLength(2);
    expect((await app.inject({ method: "POST", url, payload })).json().messages).toHaveLength(2); expect(request).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "POST", url: url.replace("/p/", "/other/"), payload })).statusCode).toBe(404);
    expect((await repo.characters("p"))[0]?.description).toBe("SECRET_NOT_FOR_MODEL");
  } finally { await app.close(); }
});
it("export requires explicit unknown-license override and rejects prohibited redistribution", async () => {
  const { app, repo } = await setup(); studioRoutes(app, repo, ":memory:");
  await repo.addReference({ id: "asset", project_id: "p", character_id: "c", name: "test", source: "owned", data_url: "data:image/png;base64,eA==", created_at: "now" });
  try { const payload = { ids: ["asset"], include_candidates: false, allow_unknown_license: false }, url = "/v1/projects/p/studio/export";
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(409);
    const exported = await app.inject({ method: "POST", url, payload: { ...payload, allow_unknown_license: true } }); expect(exported.statusCode).toBe(200); expect(exported.rawPayload.toString()).toContain("manifest.json"); expect(exported.rawPayload.toString()).toContain("sources.csv");
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/studio/records/exports" })).json().items).toHaveLength(1);
    await app.inject({ method: "POST", url: "/v1/projects/p/studio/records/licenses", payload: { asset_id: "asset", name: "Restricted", source: "source", author: "author", redistribution: "no", evidence: "no redistribution" } });
    expect((await app.inject({ method: "POST", url, payload: { ...payload, allow_unknown_license: true } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/characters/c/references/export", payload: { ids: ["asset"] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/v1/projects/other/studio/assets" })).statusCode).toBe(404);
  } finally { await app.close(); }
});

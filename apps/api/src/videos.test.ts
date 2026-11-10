import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { memoryProjects } from "./projects.js";
import { videoRoutes } from "./videos.js";
import { downloadMedia } from "./download.js";
vi.mock("./download.js", () => ({ downloadMedia: vi.fn() }));
vi.mock("./video-processing.js", () => ({ ffmpegAvailable: async () => false, processVideo: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function setup() {
  const repository = memoryProjects();
  await repository.create({ id: "p", name: "Project", created_at: "now" });
  await repository.saveCharacter({ id: "scene", project_id: "p", kind: "scene", name: "Room", description: "", updated_at: "now" });
  await repository.addReference({ id: "ref", project_id: "p", character_id: "scene", name: "master", source: "owned", data_url: "data:image/png;base64,eA==", created_at: "now" });
  await repository.standardReference("p", "scene", "ref");
  const app = buildApp(repository); videoRoutes(app, repository, ":memory:");
  const input = { request_id: randomUUID(), character_id: "scene", reference_id: "ref", prompt: "rain", camera: "fixed", duration: 5, ratio: "1280:720", loop_intent: true };
  return { app, input };
}
it("persists a video candidate, prevents duplicate submission and isolates projects", async () => {
  vi.stubEnv("RUNWAYML_API_SECRET", "test");
  const bytes = Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
  vi.mocked(downloadMedia).mockResolvedValue(bytes);
  const fetchMock = vi.fn(async (url: string) => url.endsWith("/image_to_video") ? Response.json({ id: "remote" }) : Response.json({ status: "SUCCEEDED", output: ["https://cdn.example.com/video.mp4"] }));
  vi.stubGlobal("fetch", fetchMock);
  const { app, input } = await setup();
  try {
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: input })).statusCode).toBe(202);
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos" })).json().items[0].state).toBe("running"));
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: input })).statusCode).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/image_to_video"))).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: { ...input, prompt: "different" } })).statusCode).toBe(409);
    const jobUrl = `/v1/projects/p/videos/${input.request_id}`;
    expect((await app.inject({ method: "DELETE", url: jobUrl })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: jobUrl + "/approve", payload: { loop_verified: false } })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: jobUrl + "/refresh", payload: {} });
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos" })).json().items[0].state).toBe("awaiting_review"));
    expect((await app.inject({ method: "POST", url: jobUrl + "/approve", payload: { loop_verified: false } })).json().approved).toBe(true);
    expect((await app.inject({ method: "GET", url: jobUrl + "/file" })).rawPayload).toEqual(bytes);
    const part = await app.inject({ method: "GET", url: jobUrl + "/file", headers: { range: "bytes=4-7" } }); expect(part.statusCode).toBe(206); expect(part.rawPayload.toString()).toBe("ftyp");
    expect((await app.inject({ method: "GET", url: jobUrl + "/file", headers: { range: "bytes=999-" } })).statusCode).toBe(416);
    expect((await app.inject({ method: "GET", url: jobUrl.replace("/p/", "/other/") + "/file" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: jobUrl + "/process", payload: { start: 3, end: 2, mute: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: jobUrl + "/process", payload: { start: 0, end: 5, mute: true } })).statusCode).toBe(503);
    expect((await app.inject({ method: "DELETE", url: jobUrl })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos" })).json().items).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos?trash=1" })).json().items[0]).toMatchObject({ id: input.request_id, approved: true });
    expect((await app.inject({ method: "GET", url: jobUrl + "/file" })).rawPayload).toEqual(bytes);
    expect((await app.inject({ method: "POST", url: jobUrl + "/restore" })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos" })).json().items[0].state).toBe("approved");
  } finally { await app.close(); }
});
it("rejects missing credentials, unconfirmed references and unsupported video parameters", async () => {
  vi.stubEnv("RUNWAYML_API_SECRET", ""); const { app, input } = await setup();
  try {
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: input })).statusCode).toBe(400);
    vi.stubEnv("RUNWAYML_API_SECRET", "test");
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: { ...input, reference_id: "unknown" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: { ...input, duration: 999 } })).statusCode).toBe(400);
  } finally { await app.close(); }
});
it("does not automatically resubmit ambiguous provider failures", async () => {
  vi.stubEnv("RUNWAYML_API_SECRET", "test"); const fetchMock = vi.fn(async () => { throw new Error("timeout"); }); vi.stubGlobal("fetch", fetchMock);
  const { app, input } = await setup();
  try {
    await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: input });
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: "/v1/projects/p/videos" })).json().items[0].state).toBe("reconcile_required"));
    await app.inject({ method: "POST", url: "/v1/projects/p/videos", payload: input }); expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});

import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.js";
import { generationRoutes } from "./generation.js";
import { videoRoutes } from "./videos.js";
import { memoryProjects } from "./projects.js";
import { downloadMedia } from "./download.js";

vi.mock("./download.js", () => ({ downloadMedia: vi.fn() }));
vi.mock("./video-processing.js", () => ({ ffmpegAvailable: async () => false, processVideo: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function referenceFixture(width: number, height: number) {
  const bytes = Buffer.from(png, "base64");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return "data:image/png;base64," + bytes.toString("base64");
}

async function setup() {
  vi.stubEnv("ARK_API_KEY", "standard-test-key");
  vi.stubEnv("ARK_PLAN_API_KEY", "plan-test-key");
  vi.stubEnv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3");
  const repository = memoryProjects();
  await repository.create({ id: "p", name: "Test", created_at: "now" });
  await repository.saveCharacter({ id: "c", project_id: "p", name: "Room", description: "", updated_at: "now" });
  for (const [id, width] of [["a", 512], ["b", 600], ["tiny", 100]] as const) {
    await repository.addReference({ id, project_id: "p", character_id: "c", name: id, source: "owned", created_at: "now", data_url: referenceFixture(width, 512) });
  }
  const app = buildApp(repository);
  generationRoutes(app, repository, ":memory:");
  videoRoutes(app, repository, ":memory:");
  return app;
}

const imageUrl = "/v1/projects/p/characters/c/generation";
const videoUrl = "/v1/projects/p/videos";
const flash = "doubao-seedream-5-0-flash-260915";
const seedance = "doubao-seedance-2-5-260628";
const imageInput = { provider: "seedream", model: flash, prompt: "Generate", size: "2K" };
const videoInput = { provider: "seedance", ark_profile: "standard", model: seedance, mode: "text", prompt: "Rain", camera: "fixed", ratio: "adaptive", duration: 5, resolution: "720p", generate_audio: true, loop_intent: false };

it("uses separate credentials and serializes text, reference, group, transparency and layer image requests", async () => {
  const app = await setup();
  const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ data: [{ b64_json: png, z_index: 1, name: "Caption", bounding_box: { x: 12 } }] }));
  vi.stubGlobal("fetch", fetchMock);
  const cases = [
    { input: { image_mode: "text" }, body: { model: flash, response_format: "url" } },
    { input: { image_mode: "reference", reference_ids: ["a"] }, body: { image: referenceFixture(512, 512) } },
    { input: { image_mode: "reference", reference_ids: ["a", "b"] }, body: { image: [referenceFixture(512, 512), referenceFixture(600, 512)] } },
    { input: { model: "doubao-seedream-5-0-260128", image_mode: "text", group_count: 3 }, body: { sequential_image_generation: "auto", sequential_image_generation_options: { max_images: 3 } } },
    { input: { image_mode: "reference", reference_ids: ["a"], transparent_background: true }, body: { background: "transparent", output_format: "png" } },
    { input: { ark_profile: "agent-plan", model: "doubao-seedream-5.0-flash", image_mode: "layers", reference_ids: ["a"], size: "auto" }, body: { layer_decomposition: true, size: "auto" } },
  ];
  try {
    for (const [index, item] of cases.entries()) {
      const request_id = randomUUID();
      const response = await app.inject({ method: "POST", url: imageUrl, payload: { ...imageInput, ...item.input, request_id } });
      expect(response.statusCode, response.body).toBe(202);
      await vi.waitFor(async () => {
        const { items } = (await app.inject({ method: "GET", url: imageUrl })).json();
        const job = items.find((entry: { id: string }) => entry.id === request_id);
        expect(job.state).toBe("awaiting_review");
        if (item.input.image_mode === "layers") expect(job.output_details[0]).toMatchObject({ name: "Caption", z_index: 1 });
      });
      const [url, options] = fetchMock.mock.calls[index]!;
      const plan = item.input.ark_profile === "agent-plan";
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/" + (plan ? "plan/" : "") + "v3/images/generations");
      expect(new Headers(options.headers).get("Authorization")).toBe(plan ? "Bearer plan-test-key" : "Bearer standard-test-key");
      expect(JSON.parse(String(options.body))).toMatchObject(item.body);
      if (item.input.image_mode === "text") expect(JSON.parse(String(options.body))).not.toHaveProperty("image");
    }
  } finally { await app.close(); }
});

it("rejects model/profile and media combinations before an upstream request", async () => {
  const app = await setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  try {
    for (const input of [
      { ...imageInput, ark_profile: "agent-plan" },
      { ...imageInput, image_mode: "layers", reference_ids: ["a", "b"] },
      { ...imageInput, image_mode: "text", group_count: 3 },
      { ...imageInput, image_mode: "text", size: "4K" },
      { ...imageInput, image_mode: "reference", reference_ids: ["foreign"] },
    ]) {
      expect((await app.inject({ method: "POST", url: imageUrl, payload: { ...input, request_id: randomUUID() } })).statusCode).toBe(400);
    }
    for (const input of [
      { ...videoInput, mode: "first", first_frame: { character_id: "c", reference_id: "tiny" } },
      { ...videoInput, mode: "frames", first_frame: { character_id: "c", reference_id: "a" } },
      { ...videoInput, mode: "first", ratio: "16:9", first_frame: { character_id: "c", reference_id: "a" } },
      { ...videoInput, mode: "edit", video_urls: ["https://example.com/clip.mp4"] },
      { ...videoInput, model: "doubao-seedance-2-0-fast-260128", resolution: "1080p" },
    ]) {
      expect((await app.inject({ method: "POST", url: videoUrl, payload: { ...input, request_id: randomUUID() } })).statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

it.each([
  { mode: "text", expectedRoles: [] },
  { mode: "first", expectedRoles: ["first_frame"], first_frame: { character_id: "c", reference_id: "a" } },
  { mode: "frames", expectedRoles: ["first_frame", "last_frame"], first_frame: { character_id: "c", reference_id: "a" }, last_frame: { character_id: "c", reference_id: "b" } },
  { mode: "reference", expectedRoles: ["reference_image", "reference_video", "reference_audio"], image_urls: ["asset://image"], video_urls: ["https://example.com/video.mp4"], audio_urls: ["asset://audio"] },
  { mode: "edit", expectedRoles: ["reference_video"], video_urls: ["https://example.com/video.mp4"], duration: -1 },
  { mode: "extend", expectedRoles: ["reference_video"], video_urls: ["https://example.com/video.mp4"] },
])("submits Seedance $mode and imports its MP4 candidate", async ({ expectedRoles, ...input }) => {
  const app = await setup();
  const request_id = randomUUID();
  const path = "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks";
  const mp4 = Buffer.from("0000ftypisom");
  vi.mocked(downloadMedia).mockResolvedValue(mp4);
  const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer plan-test-key");
    if (options.method === "POST") {
      expect(url).toBe(path);
      const body = JSON.parse(String(options.body));
      expect(body.model).toBe("doubao-seedance-2.5");
      expect(body.content.slice(1).map((item: { role: string }) => item.role)).toEqual(expectedRoles);
      expect(body.generate_audio).toBe(true);
      if (["reference", "edit", "extend"].includes(input.mode)) expect(body.omni_reference_task_type).toBe(input.mode);
      return Response.json({ id: "ark-job" });
    }
    expect(url).toBe(path + "/ark-job");
    return Response.json({ status: "succeeded", duration: 7, content: { video_url: "https://example.com/output.mp4" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const response = await app.inject({ method: "POST", url: videoUrl, payload: { ...videoInput, ...input, ark_profile: "agent-plan", model: "doubao-seedance-2.5", request_id } });
    expect(response.statusCode, response.body).toBe(202);
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: videoUrl })).json().items[0].state).toBe("running"));
    await app.inject({ method: "POST", url: `${videoUrl}/${request_id}/refresh` });
    await vi.waitFor(async () => expect((await app.inject({ method: "GET", url: videoUrl })).json().items[0]).toMatchObject({ state: "awaiting_review", duration_seconds: 7 }));
    expect((await app.inject({ method: "GET", url: `${videoUrl}/${request_id}/file` })).rawPayload).toEqual(mp4);
  } finally { await app.close(); }
});

it("reports official capabilities and lists visible models without generating media", async () => {
  const app = await setup();
  const fetchMock = vi.fn(async (_url: string, _options: RequestInit) => Response.json({ data: [{ id: flash }, { id: seedance }] }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const image = (await app.inject({ method: "GET", url: "/v1/image-services" })).json();
    expect(image.ark.standard.models).toContainEqual(expect.objectContaining({ id: flash, layers: true, group: false, maxReferences: 10 }));
    const video = (await app.inject({ method: "GET", url: "/v1/video-services" })).json();
    expect(video.ark.standard.models).toContainEqual(expect.objectContaining({ id: "doubao-seedance-2-0-mini-260615", resolutions: ["480p", "720p"] }));
    const status = await app.inject({ method: "POST", url: "/v1/image-services/seedream/test?profile=standard" });
    expect(status.json().visibleModels).toEqual([flash, seedance]);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("https://ark.cn-beijing.volces.com/api/v3/models", expect.objectContaining({ headers: { Authorization: "Bearer standard-test-key" } }));
    await app.inject({ method: "POST", url: "/v1/image-services/seedream/test?profile=agent-plan" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally { await app.close(); }
});

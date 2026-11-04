import { expect, it } from "vitest";
import { buildApp } from "./app.js";
it("preserves character versions and rejects access from another project", async () => {
  const app = buildApp();
  try {
    const first = (await app.inject({ method: "POST", url: "/v1/projects", payload: { name: "作品一" } })).json();
    const second = (await app.inject({ method: "POST", url: "/v1/projects", payload: { name: "作品二" } })).json();
    const url = `/v1/projects/${first.id}/characters`;
    const created = await app.inject({ method: "POST", url, payload: { name: "小夏", description: "初版" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const references = `${url}/${id}/references`;
    const payload = { name: "reference.png", source: "本人创作", data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    const uploaded = await app.inject({ method: "POST", url: references, payload });
    expect(uploaded.statusCode).toBe(201);
    const imageId = uploaded.json().id;
    expect((await app.inject({ method: "PUT", url: `${references}/standard`, payload: { image_id: imageId } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: references })).json().standard_id).toBe(imageId);
    expect((await app.inject({ method: "POST", url: references, payload: { ...payload, data_url: "data:image/png;base64,aGVsbG8=" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: `/v1/projects/${second.id}/characters/${id}/references/standard`, payload: { image_id: imageId } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `${url}/${id}`, payload: { name: "小夏", description: "新版" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${url}/${id}/history` })).json().items.map((v: { description: string }) => v.description)).toEqual(["新版", "初版"]);
    expect((await app.inject({ method: "GET", url: `/v1/projects/${second.id}/characters/${id}/history` })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, payload: { name: " ", description: "" } })).statusCode).toBe(400);
  } finally { await app.close(); }
});

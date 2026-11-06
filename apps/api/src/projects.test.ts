import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { databaseProjects } from "./projects.js";

it("keeps projects after reopening the database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gal-sqlite-"));
  const path = join(directory, "studio.sqlite");
  const project = { id: "project-1", name: "夏日终点站", created_at: new Date().toISOString() };
  let repository = databaseProjects(path);
  try {
    await repository.migrate();
    await repository.create(project);
    await repository.addMusic({ id: "music-1", project_id: project.id, name: "主题曲", purpose: "bgm", source: "本人创作", mime: "audio/wav", data: "dGVzdA==", created_at: project.created_at });
    await repository.saveCharacter({ id: "char-1", project_id: project.id, name: "小夏", description: "安静的主角", updated_at: project.created_at });
    await repository.addReference({ id: "image-1", project_id: project.id, character_id: "char-1", name: "参考图", data_url: "sample", source: "本人创作", created_at: project.created_at });
    await repository.standardReference(project.id, "char-1", "image-1");
    await repository.close();
    repository = databaseProjects(path);
    await repository.migrate();
    expect(await repository.get(project.id)).toEqual(project);
    expect(await repository.list()).toEqual([project]);
    expect((await repository.music(project.id))[0]?.name).toBe("主题曲");
    expect(await repository.music("other-project")).toEqual([]);
    expect(await repository.references(project.id, "char-1")).toHaveLength(1);
    expect(await repository.standardReference(project.id, "char-1")).toBe("image-1");
    expect(await repository.characters(project.id)).toHaveLength(1);
    expect(await repository.characters("other-project")).toEqual([]);
    await repository.saveCharacter({ id: "char-1", project_id: project.id, name: "小夏", description: "修改后的设定", updated_at: project.created_at });
    expect((await repository.characters(project.id))[0]?.description).toBe("修改后的设定");
    expect((await repository.history(project.id, "char-1")).map(v => v.description)).toEqual(["修改后的设定", "安静的主角"]);
    expect(await repository.history("other-project", "char-1")).toEqual([]);
    await repository.migrate();
    expect(await repository.history(project.id, "char-1")).toHaveLength(2);
  } finally {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it("preserves independent scene kinds and their immutable history", async () => {
  const repository = databaseProjects(":memory:");
  try {
    await repository.migrate(); await repository.create({ id: "p", name: "p", created_at: "now" });
    await repository.saveCharacter({ id: "scene", project_id: "p", kind: "scene", name: "Room", description: "Day", updated_at: "now" });
    await repository.saveCharacter({ id: "scene", project_id: "p", kind: "scene", name: "Room", description: "Night", updated_at: "later" });
    expect((await repository.characters("p"))[0]?.kind).toBe("scene");
    expect((await repository.history("p", "scene")).map(item => [item.kind, item.description])).toEqual([["scene", "Night"], ["scene", "Day"]]);
    await repository.migrate(); expect(await repository.history("p", "scene")).toHaveLength(2);
  } finally { await repository.close(); }
});

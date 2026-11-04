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
    await repository.saveCharacter({ id: "char-1", project_id: project.id, name: "小夏", description: "安静的主角", updated_at: project.created_at });
    await repository.close();
    repository = databaseProjects(path);
    await repository.migrate();
    expect(await repository.get(project.id)).toEqual(project);
    expect(await repository.list()).toEqual([project]);
    expect(await repository.characters(project.id)).toHaveLength(1);
    expect(await repository.characters("other-project")).toEqual([]);
    await repository.saveCharacter({ id: "char-1", project_id: project.id, name: "小夏", description: "修改后的设定", updated_at: project.created_at });
    expect((await repository.characters(project.id))[0]?.description).toBe("修改后的设定");
  } finally {
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

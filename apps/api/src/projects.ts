import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export type Project = { id: string; name: string; created_at: string };
export type Character = { id: string; project_id: string; name: string; description: string; updated_at: string };
export type ReferenceImage = { id: string; project_id: string; character_id: string; name: string; data_url: string; source: string; created_at: string };
export interface ProjectRepository {
  references(projectId: string, characterId: string): Promise<ReferenceImage[]>;
  addReference(image: ReferenceImage): Promise<void>;
  standardReference(projectId: string, characterId: string, imageId?: string): Promise<string | undefined>;
  history(projectId: string, characterId: string): Promise<(Character & { version_id: string })[]>;
  characters(projectId: string): Promise<Character[]>;
  saveCharacter(character: Character): Promise<Character>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  create(project: Project): Promise<Project>;
}

export function databaseProjects(filename: string) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
  return {
    async migrate() {
      db.exec(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reference_images (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, character_id TEXT NOT NULL,
        name TEXT NOT NULL, data_url TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS standard_references (
        project_id TEXT NOT NULL, character_id TEXT NOT NULL, image_id TEXT NOT NULL,
        PRIMARY KEY(project_id, character_id)
      );
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL, description TEXT NOT NULL, updated_at TEXT NOT NULL
      ); CREATE INDEX IF NOT EXISTS characters_project ON characters(project_id);
      CREATE TABLE IF NOT EXISTS character_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, version_id TEXT NOT NULL UNIQUE,
        id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO character_history (version_id,id,project_id,name,description,updated_at)
        SELECT lower(hex(randomblob(16))),id,project_id,name,description,updated_at FROM characters c
        WHERE NOT EXISTS (SELECT 1 FROM character_history h WHERE h.id=c.id);`);
    },
    async history(projectId: string, characterId: string) {
      return db.prepare("SELECT version_id,id,project_id,name,description,updated_at FROM character_history WHERE project_id=? AND id=? ORDER BY sequence DESC").all(projectId, characterId) as (Character & { version_id: string })[];
    },
    async references(projectId: string, characterId: string) {
      return db.prepare("SELECT * FROM reference_images WHERE project_id=? AND character_id=? ORDER BY created_at DESC,id").all(projectId, characterId) as ReferenceImage[];
    },
    async addReference(image: ReferenceImage) {
      db.prepare("INSERT INTO reference_images (id,project_id,character_id,name,data_url,source,created_at) VALUES (?,?,?,?,?,?,?)").run(image.id, image.project_id, image.character_id, image.name, image.data_url, image.source, image.created_at);
    },
    async standardReference(projectId: string, characterId: string, imageId?: string) {
      if (imageId) db.prepare("INSERT INTO standard_references VALUES (?,?,?) ON CONFLICT(project_id,character_id) DO UPDATE SET image_id=excluded.image_id").run(projectId, characterId, imageId);
      return (db.prepare("SELECT image_id FROM standard_references WHERE project_id=? AND character_id=?").get(projectId, characterId) as { image_id: string } | undefined)?.image_id;
    },
    async characters(projectId: string) {
      return db.prepare("SELECT * FROM characters WHERE project_id = ? ORDER BY updated_at DESC, id").all(projectId) as Character[];
    },
    async saveCharacter(character: Character) {
      db.exec("BEGIN IMMEDIATE");
      try {
      db.prepare(`INSERT INTO characters (id, project_id, name, description, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at WHERE characters.project_id=excluded.project_id`)
        .run(character.id, character.project_id, character.name, character.description, character.updated_at);
      db.prepare("INSERT INTO character_history (version_id,id,project_id,name,description,updated_at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), character.id, character.project_id, character.name, character.description, character.updated_at);
      db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return character;
    },
    async list() {
      return db.prepare("SELECT id, name, created_at FROM projects ORDER BY created_at DESC, id").all() as Project[];
    },
    async get(id: string) {
      return db.prepare("SELECT id, name, created_at FROM projects WHERE id = ?").get(id) as Project | undefined;
    },
    async create(project: Project) {
      db.prepare("INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)").run(project.id, project.name, project.created_at);
      return project;
    },
    async close() { db.close(); },
  };
}

export function memoryProjects(): ProjectRepository {
  const rows = new Map<string, Project>();
  const characters = new Map<string, Character>();
  const history: (Character & { version_id: string })[] = [];
  const references: ReferenceImage[] = [];
  const standards = new Map<string, string>();
  return {
    async references(projectId, characterId) { return references.filter(i => i.project_id === projectId && i.character_id === characterId); },
    async addReference(image) { references.push(image); },
    async standardReference(projectId, characterId, imageId) { const key = `${projectId}/${characterId}`; if (imageId) standards.set(key, imageId); return standards.get(key); },
    async history(projectId, characterId) { return history.filter(c => c.project_id === projectId && c.id === characterId).reverse(); },
    async characters(projectId) { return [...characters.values()].filter(c => c.project_id === projectId); },
    async saveCharacter(character) { characters.set(character.id, character); history.push({ ...character, version_id: randomUUID() }); return character; },
    async list() { return [...rows.values()].reverse(); },
    async get(id) { return rows.get(id); },
    async create(project) { rows.set(project.id, project); return project; },
  };
}

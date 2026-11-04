import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Project = { id: string; name: string; created_at: string };
export type Character = { id: string; project_id: string; name: string; description: string; updated_at: string };
export interface ProjectRepository {
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
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL, description TEXT NOT NULL, updated_at TEXT NOT NULL
      ); CREATE INDEX IF NOT EXISTS characters_project ON characters(project_id);`);
    },
    async characters(projectId: string) {
      return db.prepare("SELECT * FROM characters WHERE project_id = ? ORDER BY updated_at DESC, id").all(projectId) as Character[];
    },
    async saveCharacter(character: Character) {
      db.prepare(`INSERT INTO characters (id, project_id, name, description, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, updated_at=excluded.updated_at WHERE characters.project_id=excluded.project_id`)
        .run(character.id, character.project_id, character.name, character.description, character.updated_at);
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
  return {
    async characters(projectId) { return [...characters.values()].filter(c => c.project_id === projectId); },
    async saveCharacter(character) { characters.set(character.id, character); return character; },
    async list() { return [...rows.values()].reverse(); },
    async get(id) { return rows.get(id); },
    async create(project) { rows.set(project.id, project); return project; },
  };
}

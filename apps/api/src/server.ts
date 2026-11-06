import { conversationRoutes } from "./conversations.js";
import { audioGenerationRoutes } from "./audio-generation.js";
import { studioRoutes } from "./studio.js";
import { videoRoutes } from "./videos.js";
import { buildApp } from "./app.js";
import { generationRoutes } from "./generation.js";
import { databaseProjects } from "./projects.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
const databasePath = process.env.DATABASE_PATH ?? fileURLToPath(new URL("../../../data/studio.sqlite", import.meta.url));
const repository = databaseProjects(databasePath);
await repository.migrate();
const app = buildApp(repository);
generationRoutes(app, repository, databasePath);
videoRoutes(app, repository, databasePath);
studioRoutes(app, repository, databasePath);
audioGenerationRoutes(app, repository, databasePath);
conversationRoutes(app, repository, databasePath);
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
app.get("/", async (_, reply) => reply.type("text/html; charset=utf-8").send(await readFile(resolve(webRoot, "index.html"))));
app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
  const path = resolve(webRoot, "assets", request.params["*"]);
  if (!path.startsWith(resolve(webRoot, "assets") + sep)) return reply.code(404).send();
  try { return reply.type(mime[extname(path)] ?? "application/octet-stream").send(await readFile(path)); }
  catch { return reply.code(404).send(); }
});
app.addHook("onClose", () => repository.close());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { void app.close(); });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}


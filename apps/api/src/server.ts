import { buildApp } from "./app.js";
import { databaseProjects } from "./projects.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
const repository = databaseProjects(process.env.DATABASE_PATH ?? fileURLToPath(new URL("../../../data/studio.sqlite", import.meta.url)));
await repository.migrate();
const app = buildApp(repository);
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


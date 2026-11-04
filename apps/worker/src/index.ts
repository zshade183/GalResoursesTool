const shutdown = (signal: string) => {
  console.log(JSON.stringify({ level: "info", service: "worker", signal, message: "worker stopped" }));
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(JSON.stringify({ level: "info", service: "worker", message: "worker started" }));


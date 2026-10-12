import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { config } from "./config";
import { recoverInterruptedWork } from "./db";
import { purgeExpiredExports } from "./jobs/exportJob";
import { registerRoutes } from "./routes";
import { HttpError } from "./util";

const app = Fastify({ logger: { level: config.production ? "info" : "warn" }, bodyLimit: 2_000_000 });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: "invalid_request", message: err.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; "), details: err.issues });
  }
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
  if ((err as { name?: string }).name === "ProviderError") return reply.code(502).send({ error: "provider_error", message: err.message });
  if (err.validation) return reply.code(400).send({ error: "invalid_request", message: err.message });
  app.log.error(err);
  return reply.code(500).send({ error: "internal_error", message: "Something went wrong on the server. The error has been logged." });
});

await registerRoutes(app);

const webDist = resolve("dist/web");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found", message: "Unknown API route." });
    if (req.url.startsWith("/assets/")) return reply.code(404).send("Not found");
    return reply.sendFile("index.html");
  });
}

recoverInterruptedWork();
await purgeExpiredExports();
setInterval(() => void purgeExpiredExports(), 60 * 60 * 1000).unref();

await app.listen({ port: config.port, host: config.host });
console.log(`BizIntel API listening on http://${config.host}:${config.port}`);

// ---------------------------------------------------------------------------
// index.ts — server bootstrap. See README.md for env vars and fixture mode.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import { randomUUID } from "node:crypto";

import { loadConfig } from "./config.js";
import { createLogger, fastifyLoggerOptions } from "./logger.js";
import { createDataSource } from "./data-source.js";
import { ModelCache } from "./cache.js";
import type { AppContext } from "./context.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerModelRoute } from "./routes/model.js";
import { registerReferenceRoutes } from "./routes/reference.js";
import { AuthError } from "./auth/middleware.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };

export async function buildServer() {
  const config = loadConfig();
  const log = createLogger(config);

  const app = Fastify({
    genReqId: () => randomUUID(),
    disableRequestLogging: false,
    logger: fastifyLoggerOptions(config),
  });

  await app.register(cors, { origin: config.corsOrigin ?? true });
  await app.register(compress, { global: true, threshold: 1024 });

  // Never crash the process on a request-handling error — log it, respond
  // 500 (or the error's own status, for our typed AuthError/validation
  // errors that routes throw instead of catching locally).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AuthError) {
      reply.code(err.status).send({ error: err.message });
      return;
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    req.log.error({ err }, "request error");
    reply.code(status).send({ error: status >= 500 ? "Internal server error" : err instanceof Error ? err.message : String(err) });
  });

  const data = await createDataSource(config, log);
  const ctx: AppContext = {
    config,
    log,
    data,
    modelCache: new ModelCache(),
    appVersion: pkg.version,
  };

  registerHealthRoute(app, ctx);
  registerModelRoute(app, ctx);
  registerReferenceRoutes(app, ctx);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down");
    try {
      await app.close();
      await data.db?.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // Belt-and-braces: never let an unhandled rejection/exception outside the
  // Fastify request lifecycle take the process down.
  process.on("unhandledRejection", (err) => log.error({ err }, "unhandledRejection"));
  process.on("uncaughtException", (err) => log.error({ err }, "uncaughtException"));

  return { app, ctx };
}

async function main() {
  const { app, ctx } = await buildServer();
  try {
    await app.listen({ port: ctx.config.port, host: "0.0.0.0" });
  } catch (err) {
    ctx.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

// Only auto-start when run directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}

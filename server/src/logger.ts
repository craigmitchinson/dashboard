import pino from "pino";
import type { Config } from "./config.js";

/** A standalone pino instance for use BEFORE/OUTSIDE the Fastify request
 *  lifecycle (startup, the SQL connection pool, the data-source factory).
 *  Fastify gets its OWN internal pino instance via fastifyLoggerOptions()
 *  below instead of this one — handing Fastify an externally-constructed
 *  pino instance runs into brittle cross-version type friction between
 *  fastify's bundled pino types and the `pino` package's own; a plain
 *  options object lets Fastify build a compatible logger itself, and both
 *  end up structured JSON pino output regardless. */
export function createLogger(config: Config) {
  return pino(fastifyLoggerOptions(config));
}

export function fastifyLoggerOptions(config: Config) {
  const pretty = config.nodeEnv !== "production";
  return {
    level: config.logLevel,
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } } } : {}),
    base: { service: "ia-coe-dashboard-api" },
  };
}

export type Logger = ReturnType<typeof createLogger>;

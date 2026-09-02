// ---------------------------------------------------------------------------
// config.ts — env var parsing, once, at startup. See README.md for the full
// list and fixture-mode instructions.
// ---------------------------------------------------------------------------

function bool(v: string | undefined, def: boolean): boolean {
  if (v == null || v === "") return def;
  return v === "1" || v.toLowerCase() === "true";
}

export type AuthMode = "entra" | "dev" | "none";
export type DataSource = "sql" | "fixtures";

export interface Config {
  port: number;
  nodeEnv: string;
  corsOrigin: string | undefined;
  logLevel: string;

  authMode: AuthMode;
  entraTenantId: string | undefined;
  entraAudience: string | undefined;

  dataSource: DataSource;
  fixturesDir: string | undefined;

  sql: {
    server: string | undefined;
    port: number;
    database: string | undefined;
    user: string | undefined;
    password: string | undefined;
    encrypt: boolean;
    trustServerCertificate: boolean;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = (env.AUTH_MODE ?? "none") as AuthMode;
  const nodeEnv = env.NODE_ENV ?? "development";

  // PRODUCTION GUARD: AUTH_MODE=dev (trusts an X-Dev-User header verbatim,
  // no signature) and AUTH_MODE=none (no auth at all) are for local dev /
  // fixture-mode CI only. Refuse to start rather than silently exposing
  // an unauthenticated write path in production.
  if ((authMode === "dev" || authMode === "none") && nodeEnv === "production") {
    throw new Error(
      `Refusing to start: AUTH_MODE=${authMode} is not permitted when NODE_ENV=production (see server/README.md's Auth section).`,
    );
  }

  const dataSource = (env.DATA_SOURCE ?? "sql") as DataSource;
  if (dataSource === "fixtures" && !env.FIXTURES_DIR) {
    throw new Error("DATA_SOURCE=fixtures requires FIXTURES_DIR to be set (see server/README.md's Fixture Mode section).");
  }

  return {
    port: Number(env.PORT ?? 8080),
    nodeEnv,
    corsOrigin: env.CORS_ORIGIN,
    logLevel: env.LOG_LEVEL ?? "info",

    authMode,
    entraTenantId: env.ENTRA_TENANT_ID,
    entraAudience: env.ENTRA_AUDIENCE,

    dataSource,
    fixturesDir: env.FIXTURES_DIR,

    sql: {
      server: env.SQL_SERVER,
      port: Number(env.SQL_PORT ?? 1433),
      database: env.SQL_DATABASE,
      user: env.SQL_USER,
      password: env.SQL_PASSWORD,
      encrypt: bool(env.SQL_ENCRYPT, true),
      trustServerCertificate: bool(env.SQL_TRUST_CERT, false),
    },
  };
}

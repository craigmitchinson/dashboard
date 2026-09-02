// ---------------------------------------------------------------------------
// db.ts — SQL Server connection pool (mssql) with startup retry/backoff.
// Never throws out of `getPool()` once the app is running: callers check
// `isConnected()` and degrade (see routes/health.ts, routes/model.ts).
// ---------------------------------------------------------------------------
import sql from "mssql";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

export class Db {
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<void> | null = null;
  private lastError: Error | null = null;

  constructor(
    private config: Config,
    private log: Logger,
  ) {}

  private get sqlConfig(): sql.config {
    const { server, port, database, user, password, encrypt, trustServerCertificate } = this.config.sql;
    if (!server || !database) throw new Error("SQL_SERVER and SQL_DATABASE are required when DATA_SOURCE=sql");
    return {
      server,
      port,
      database,
      user,
      password,
      options: { encrypt, trustServerCertificate },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 15000,
      requestTimeout: 30000,
    };
  }

  /** Connects with exponential backoff (capped). Resolves once connected;
   *  logs and keeps retrying in the background if called at startup and the
   *  DB isn't up yet — never rejects the process. */
  async connectWithRetry(maxAttempts = Infinity): Promise<void> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      let attempt = 0;
      for (;;) {
        attempt++;
        try {
          const pool = new sql.ConnectionPool(this.sqlConfig);
          pool.on("error", (err) => {
            this.log.error({ err }, "SQL pool error");
            this.lastError = err;
          });
          await pool.connect();
          this.pool = pool;
          this.lastError = null;
          this.log.info("Connected to SQL Server");
          return;
        } catch (err) {
          this.lastError = err as Error;
          this.log.warn({ err, attempt }, "SQL Server connection attempt failed");
          if (attempt >= maxAttempts) return;
          const delayMs = Math.min(30000, 500 * 2 ** Math.min(attempt, 6));
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  isConnected(): boolean {
    return !!this.pool?.connected;
  }

  getLastError(): Error | null {
    return this.lastError;
  }

  /** Throws if not connected — callers must check isConnected() first, or
   *  catch, for a request-time DB hiccup. */
  request(): sql.Request {
    if (!this.pool?.connected) throw new Error("Database not connected");
    return this.pool.request();
  }

  transaction(): sql.Transaction {
    if (!this.pool?.connected) throw new Error("Database not connected");
    return new sql.Transaction(this.pool);
  }

  async close(): Promise<void> {
    await this.pool?.close();
    this.pool = null;
  }
}

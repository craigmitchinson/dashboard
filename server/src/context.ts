import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { DataSourceBundle } from "./data-source.js";
import type { ModelCache } from "./cache.js";

export interface AppContext {
  config: Config;
  log: Logger;
  data: DataSourceBundle;
  modelCache: ModelCache;
  appVersion: string;
}

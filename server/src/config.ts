export interface Config {
  port: number;
  host: string;
  /** `postgres://…` for PostgreSQL, otherwise a SQLite file path (or `:memory:`). */
  databaseUrl: string;
  /** Public URL of the app, used for invite links in exports. */
  publicUrl: string;
  /** Optional donations page (GitHub Sponsors, Ko-fi, Open Collective…). */
  donationUrl: string;
  /** Link to the source code, required by the AGPL when you run a modified version. */
  sourceUrl: string;
  /** Directory with the built web client; empty to serve the API only. */
  webDir: string;
  trustProxy: boolean;
  logLevel: string;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? './data/sprintwell.db',
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/$/, ''),
    donationUrl: env.DONATION_URL ?? '',
    sourceUrl: env.SOURCE_URL ?? '',
    webDir: env.WEB_DIR ?? '',
    trustProxy: env.TRUST_PROXY === 'true' || env.TRUST_PROXY === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
    version: env.npm_package_version ?? '0.1.0',
  };
}

export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

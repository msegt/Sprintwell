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
  /**
   * GitLab features. With url and secret: verifying GitLab accounts with a
   * personal access token, project sync with project access tokens, webhooks.
   * With clientId and clientSecret too: Sign in with GitLab (OAuth).
   */
  gitlab: GitlabSettings;
  /** Long random value used to encrypt stored GitLab tokens. */
  secret: string;
}

export interface GitlabSettings {
  /** Base URL of the GitLab instance, e.g. https://git.cardiff.ac.uk */
  url: string;
  clientId: string;
  clientSecret: string;
}

export function gitlabEnabled(config: Pick<Config, 'gitlab' | 'secret'>): boolean {
  return !!(config.gitlab.url && config.secret.length >= 16);
}

export function gitlabOAuthEnabled(config: Pick<Config, 'gitlab' | 'secret'>): boolean {
  return gitlabEnabled(config) && !!(config.gitlab.clientId && config.gitlab.clientSecret);
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
    version: env.npm_package_version ?? '0.3.0',
    gitlab: {
      url: (env.GITLAB_URL ?? '').replace(/\/$/, ''),
      clientId: env.GITLAB_CLIENT_ID ?? '',
      clientSecret: env.GITLAB_CLIENT_SECRET ?? '',
    },
    secret: env.SPRINTWELL_SECRET ?? '',
  };
}

export function isPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\//i.test(url);
}

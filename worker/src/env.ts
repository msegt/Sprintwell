import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { Database } from '../../server/src/db/schema';
import type { Config } from '../../server/src/config';
import { Repo } from '../../server/src/repo';
import type { TeamRoom } from './team-room';

export interface Env {
  DB: D1Database;
  TEAM_ROOM: DurableObjectNamespace<TeamRoom>;
  ASSETS: Fetcher;
  DONATION_URL?: string;
  SOURCE_URL?: string;
  /** "1" turns off the best-effort rate limits (local testing only). */
  DISABLE_RATE_LIMIT?: string;
  /** Sign in with GitLab, e.g. https://git.cardiff.ac.uk (a plain variable). */
  GITLAB_URL?: string;
  GITLAB_CLIENT_ID?: string;
  /** Secrets: set with `npx wrangler secret put …`. */
  GITLAB_CLIENT_SECRET?: string;
  SPRINTWELL_SECRET?: string;
}

/** D1 has no interactive transactions, so the repo runs grouped writes in sequence. */
export function makeRepo(env: Env): Repo {
  const db = new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
  return new Repo(db, { transactions: false });
}

export function teamRoom(env: Env, teamId: string): DurableObjectStub<TeamRoom> {
  return env.TEAM_ROOM.get(env.TEAM_ROOM.idFromName(teamId));
}

export const log = {
  warn: (obj: unknown, msg: string) => console.warn(msg, obj),
  error: (obj: unknown, msg: string) => console.error(msg, obj),
};

export function configFromEnv(env: Env): Config {
  return {
    port: 0,
    host: '',
    databaseUrl: 'd1',
    publicUrl: '',
    donationUrl: env.DONATION_URL ?? '',
    sourceUrl: env.SOURCE_URL ?? '',
    webDir: '',
    trustProxy: true,
    logLevel: 'info',
    version: '0.3.0',
    gitlab: { url: (env.GITLAB_URL ?? '').replace(/\/$/, ''), clientId: env.GITLAB_CLIENT_ID ?? '', clientSecret: env.GITLAB_CLIENT_SECRET ?? '' },
    secret: env.SPRINTWELL_SECRET ?? '',
  };
}

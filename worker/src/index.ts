import { Hono, type Context } from 'hono';
import { sql } from 'kysely';
import type { Config } from '../../server/src/config';
import { MeetingManager } from '../../server/src/meetings/manager';
import { registerApi } from '../../server/src/routes/api';
import { FileResponse, makeRouter, type ApiRouter, type RealtimeControl } from '../../server/src/routes/router';
import { HttpError } from '../../server/src/util';
import { log, makeRepo, teamRoom, type Env } from './env';
import { RateLimiter } from './rate-limit';

export { TeamRoom } from './team-room';

const MAX_BODY = 512 * 1024;
const strictLimiter = new RateLimiter(20, 60_000);
const globalLimiter = new RateLimiter(600, 60_000);

type AppEnv = { Bindings: Env };

/**
 * Fire-and-forget calls to Durable Objects made while handling a request.
 * The fetch handler hands them to ctx.waitUntil so they finish after the response.
 */
const pending: Promise<unknown>[] = [];

function control(env: Env): RealtimeControl {
  const post = (teamId: string, path: string, body: unknown = {}) => {
    pending.push(
      teamRoom(env, teamId)
        .fetch(`https://team-room${path}`, { method: 'POST', headers: { 'x-team-id': teamId, 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .catch((err) => log.warn({ err }, `team room ${path} failed`)),
    );
  };
  return {
    notifyTeam: (teamId) => post(teamId, '/notify'),
    revoke: (teamId, userId) => post(teamId, '/revoke', { userId }),
    forgetTeam: (teamId) => post(teamId, '/forget-team'),
    forgetMeeting: (teamId, meetingId) => post(teamId, '/forget-meeting', { meetingId }),
  };
}

function buildApi(env: Env): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const repo = makeRepo(env);
  const realtime = control(env);
  // Stateless here: every request reads meetings from D1; live state is owned by the TeamRoom objects.
  const meetings = new MeetingManager(repo, { online: () => [], broadcastMeeting: () => undefined, notifyTeam: realtime.notifyTeam }, { timers: null, evictAfterMs: null, cache: false });
  const config: Config = {
    port: 0,
    host: '',
    databaseUrl: 'd1',
    publicUrl: '',
    donationUrl: env.DONATION_URL ?? '',
    sourceUrl: env.SOURCE_URL ?? '',
    webDir: '',
    trustProxy: true,
    logLevel: 'info',
    version: '0.2.0',
  };

  const router: ApiRouter = makeRouter((method, path, handler, options) => {
    app.on(method, path, async (c: Context<AppEnv>) => {
      const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
      if (env.DISABLE_RATE_LIMIT !== '1') {
        if (!globalLimiter.take(ip) || (options.strict && !strictLimiter.take(`${ip}:${path}`))) {
          return c.json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);
        }
      }
      let body: unknown = undefined;
      if (method !== 'GET') {
        const text = await c.req.text();
        if (text.length > MAX_BODY) return c.json({ error: 'Request too large' }, 413);
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            return c.json({ error: 'Invalid JSON' }, 400);
          }
        }
      }
      const headers: Record<string, string | undefined> = {};
      c.req.raw.headers.forEach((v, k) => (headers[k] = v));
      const result = await handler({ params: c.req.param() as Record<string, string>, body, headers, ip });
      if (result instanceof FileResponse) return new Response(result.body, { headers: result.headers });
      return c.json(result as object);
    });
  });
  registerApi(router, { repo, realtime, meetings, config });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, ...(err.details !== undefined && { details: err.details }) }, err.status as 400);
    log.error({ err: String(err), stack: (err as Error).stack }, 'request failed');
    return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  return app;
}

let cached: { env: Env; app: Hono<AppEnv> } | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const teamId = url.searchParams.get('team');
      if (!teamId || !/^[0-9a-z]{1,64}$/.test(teamId)) return new Response('Missing team', { status: 400 });
      const headers = new Headers(request.headers);
      headers.set('x-team-id', teamId);
      return teamRoom(env, teamId).fetch(new Request('https://team-room/ws', { headers }));
    }

    if (url.pathname === '/healthz') {
      await sql`select 1`.execute(makeRepo(env).db);
      return Response.json({ ok: true, db: 'd1' });
    }

    if (url.pathname.startsWith('/api/')) {
      if (!cached || cached.env !== env) cached = { env, app: buildApi(env) };
      const response = await cached.app.fetch(request, env, ctx);
      if (pending.length) ctx.waitUntil(Promise.allSettled(pending.splice(0)));
      response.headers.set('x-content-type-options', 'nosniff');
      response.headers.set('cache-control', 'no-store');
      return response;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

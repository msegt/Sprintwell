import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import { openDatabase, ping, type DbHandle } from './db';
import { MeetingManager } from './meetings/manager';
import { Hub } from './realtime/hub';
import { Repo } from './repo';
import { registerApi } from './routes/api';
import { FileResponse, makeRouter } from './routes/router';
import { HttpError } from './util';

export interface App {
  app: FastifyInstance;
  db: DbHandle;
  repo: Repo;
  hub: Hub;
  meetings: MeetingManager;
}

export async function buildApp(config: Config, opts: { logger?: boolean } = {}): Promise<App> {
  const db = await openDatabase(config.databaseUrl);
  const app = Fastify({
    logger: opts.logger === false ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
  });

  const repo = new Repo(db.db);
  const hub = new Hub(repo, app.log);
  const meetings = new MeetingManager(repo, hub);
  hub.manager = meetings;

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Browser-side GitLab import talks to the team's own GitLab instance.
        connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute', allowList: () => process.env.SPRINTWELL_DISABLE_RATE_LIMIT === '1' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, ...(err.details !== undefined && { details: err.details }) });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error({ err }, 'request failed');
    return reply.status(500).send({ error: 'Something went wrong on our side. Please try again.' });
  });

  app.get('/healthz', async () => {
    await ping(db.db);
    return { ok: true, db: db.dialect };
  });

  app.get('/ws', { websocket: true }, (socket) => hub.accept(socket));

  const router = makeRouter((method, url, handler, options) => {
    app.route({
      method,
      url,
      config: options.strict ? { rateLimit: { max: 20, timeWindow: '1 minute' } } : {},
      handler: async (req, reply) => {
        const result = await handler({
          params: req.params as Record<string, string>,
          body: req.body,
          headers: req.headers as Record<string, string | undefined>,
          ip: req.ip,
        });
        if (result instanceof FileResponse) return reply.headers(result.headers).send(result.body);
        return result;
      },
    });
  });
  registerApi(router, {
    repo,
    meetings,
    config,
    realtime: {
      notifyTeam: (teamId) => hub.notifyTeam(teamId),
      revoke: (teamId, userId) => void hub.revoke(teamId, userId),
      forgetTeam: (teamId) => meetings.forgetTeam(teamId),
      forgetMeeting: (_teamId, meetingId) => meetings.forget(meetingId),
    },
  });

  const webDir = config.webDir ? resolve(config.webDir) : '';
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false, maxAge: '1h' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url === '/ws') {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Not found' }));
  }

  app.addHook('onClose', async () => {
    hub.close();
    await db.close();
  });

  return { app, db, repo, hub, meetings };
}

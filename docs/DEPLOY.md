# Deploying Sprintwell

Sprintwell is one Node.js process that serves the web app, the REST API and the WebSocket used for real-time events. It needs:

1. **A host that runs a long-lived process and supports WebSockets.** Serverless function platforms, such as Vercel functions or Netlify functions, are not a good fit because they don't keep WebSocket connections open.
2. **A database.** SQLite is fine on a machine with a persistent disk. On most managed platforms the local disk is wiped on every deploy or restart, so use **PostgreSQL** there.

Switching databases needs no code change. Set `DATABASE_URL` to a `postgres://` connection string and Sprintwell creates its tables on first start.

## Recommended low-maintenance set-up: Render + Neon

This set-up involves no servers to patch: Render builds and runs the Docker image, and Neon runs PostgreSQL.

1. **Create the database on [Neon](https://neon.com).** The free plan offers 1 GB of storage per project and scales to zero when idle (per Neon's pricing page in October 2026; check before relying on it). Copy the connection string; it ends in `?sslmode=require`.
2. **Push this repository to GitHub** (or GitLab).
3. **On [Render](https://render.com), create a new *Web Service* from the repository** and choose the **Docker** runtime. The `render.yaml` blueprint in this repo describes the same thing, but it has not been tested.
4. **Set these environment variables:**
   - `DATABASE_URL`: the Neon connection string.
   - `TRUST_PROXY`: `true`.
   - `PUBLIC_URL`: the address Render gives you, or your own domain.
   - `SOURCE_URL`: the public repository URL. The AGPL requires this if you change the code.
   - `DONATION_URL`: optional, for example a GitHub Sponsors or Ko-fi page.
5. **Set the health check path** to `/healthz`.

### Free versus paid instance

Render's free web services have limits that matter for live events. These are per Render's docs in October 2026, so check the current terms:

- **They sleep after 15 minutes without traffic.** The first visitor after a quiet spell waits about a minute while the service wakes up. Messages on open WebSockets keep it awake during an event.
- **Monthly hours are capped.** Each workspace gets 750 free instance hours a month.
- **The disk is temporary.** Anything on local disk is lost on restart, which is why the database must be PostgreSQL.
- **Render's own free PostgreSQL expires after 30 days.** Use Neon or another provider instead.

For a class that relies on it every week, a small paid instance avoids the wake-up delay. Check Render's current prices.

### Alternatives

- **Fly.io or Railway:** both run the same Dockerfile. Set the same environment variables.
- **A university or departmental virtual machine:** run `docker compose up -d`. SQLite with the `/data` volume is enough for a few hundred users. Put the app behind a reverse proxy with HTTPS and pass WebSocket upgrades through.

## Scaling notes

- **One instance only, for now.** Live event state is held in memory and pushed out over WebSockets from that one process. Running two or more instances behind a load balancer would split people across them. Scaling out would need a shared message bus, such as PostgreSQL `LISTEN/NOTIFY` or Redis; see the roadmap. A single small instance should be enough for many teams, but this hasn't been load-tested.
- **Back-ups.** With PostgreSQL, use your provider's back-ups. With SQLite, back up `/data/sprintwell.db` (for example `sqlite3 sprintwell.db ".backup backup.db"`).

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `./data/sprintwell.db` | `postgres://…` or a SQLite file path |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Interface to listen on |
| `PUBLIC_URL` | (empty) | Public address of the app |
| `WEB_DIR` | (empty) | Folder with the built web app (`web/dist`); set automatically in Docker |
| `TRUST_PROXY` | `false` | Set to `true` behind a proxy so rate limits see real client IPs |
| `DONATION_URL` | (empty) | Shown on the Support page |
| `SOURCE_URL` | (empty) | Link to the source code (AGPL) |
| `LOG_LEVEL` | `info` | Fastify log level |
| `PG_POOL_MAX` | `10` | Maximum PostgreSQL connections |

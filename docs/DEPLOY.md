# Deploying Sprintwell

There are two ways to run Sprintwell. Both use the same web app, API and real-time protocol, and both run the same automated tests.

| | Cloudflare (recommended) | Node server |
|---|---|---|
| What runs it | Cloudflare Workers, Durable Objects and D1 | Any machine or platform that runs Node.js 22 or Docker |
| Servers to look after | None | One process (managed for you on platforms such as Render or Fly.io) |
| Database | D1 (SQLite, managed by Cloudflare) | SQLite file or PostgreSQL |
| Cost for a class | Free plan should be enough (see limits below) | Depends on host |

## Option 1: Cloudflare, free plan (recommended)

### How it fits together

```
Browser ─▶ Worker ── static web app (Workers static assets)
              ├──── REST API ───────────────▶ D1 (SQLite database)
              └──── /ws?team=… ─▶ TeamRoom Durable Object (one per team)
                                    ├─ live events: votes, cards, timers
                                    └─ reads and writes D1
```

Each team gets its own Durable Object. That object holds the team's WebSocket connections and handles its events one command at a time. It uses Cloudflare's WebSocket Hibernation API: between messages it can be unloaded from memory without dropping connections, so an open browser tab does not use up the free allowance. Pairing-timer rotations use Durable Object alarms.

### One-time set-up (about 10 minutes)

You need a free Cloudflare account and Node.js 22 on your computer. In a terminal, in the `Sprintwell` folder:

```bash
npm install
npx wrangler login                 # opens the browser to sign in to Cloudflare
npx wrangler d1 create sprintwell --location weur  # creates the database in Western Europe and prints its "database_id"
```

If your institution needs the data kept inside the EU, use `--jurisdiction eu` instead of `--location weur`.

Copy the `database_id` into `worker/wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`. Then deploy:

```bash
npm run deploy:cf
```

This builds the web app, creates the database tables (D1 migrations) and deploys the Worker. Wrangler prints the address, something like `https://sprintwell.<your-subdomain>.workers.dev`. Share that with your students.

**Updating later:** pull the latest code and run `npm run deploy:cf` again. New database migrations are applied automatically.

**Optional settings**, in `worker/wrangler.jsonc` under `vars` or in the Cloudflare dashboard (Worker → Settings → Variables):

- `DONATION_URL`: shown on the Support page.
- `SOURCE_URL`: link to your public repository. The AGPL requires this if you change the code.

**Custom domain:** in the Cloudflare dashboard, open the Worker, then Settings → Domains & Routes.

**Deploying without a terminal:** Cloudflare can build and deploy straight from a GitHub or GitLab repository (Workers → Create → Import a repository). Use:

- build command: `npm ci && npm run build -w web`
- deploy command: `cd worker && npx wrangler d1 migrations apply sprintwell --remote && npx wrangler deploy`

You still need to create the D1 database once and put its id in `worker/wrangler.jsonc`. This route has not been tested.

### Free-plan limits

These are the Workers Free plan limits per Cloudflare's documentation in October 2026. They reset daily at 00:00 UTC, and when a limit is reached, further requests of that type fail until the reset.

| Limit | Free plan | Rough use for a class of ~16 students in 4 teams |
|---|---|---|
| Worker and Durable Object requests | 100,000 a day | Low thousands on a busy teaching day |
| D1 rows read | 5 million a day | Each page refresh reads the team's rows (a few hundred) |
| D1 rows written | 100,000 a day | One or two per vote, card or edit |
| Durable Object duration | 13,000 GB-s a day | Small, thanks to hibernation |
| Storage | 5 GB | Far more than needed |
| CPU time | 10 ms per request | See the caveat below |

The usage estimates are mine and have not been measured on the live service. Check the dashboard's usage graphs during the first sessions.

**Main caveat: CPU time.** The free plan allows 10 ms of CPU per request. Normal requests should fit comfortably; the heaviest is the full JSON export of a team with many events. If requests start failing with CPU-limit errors, the Workers Paid plan raises the limit; check Cloudflare's current price.

**Rate limiting** in the Cloudflare version is best-effort, because each Worker instance counts separately. For stronger protection, add a rate-limiting rule in the Cloudflare dashboard.

### Running the Cloudflare version locally

```bash
npm run dev:cf        # builds the web app, prepares a local D1 database, runs on http://localhost:8787
```

This uses Cloudflare's local runtime (workerd), so Durable Objects, D1 and WebSockets behave as they do when deployed. To run the test suites against it, while it runs:

```bash
npm run test:cf
E2E_BASE_URL=http://127.0.0.1:8787 npm run test:e2e
```

For tests, start it with rate limits off: `cd worker && npx wrangler dev --port 8787 --var DISABLE_RATE_LIMIT:1`.

### Changing the database schema

Add a Kysely migration in `server/src/db/migrations.ts` (used by the Node version). Then write the matching SQL as a new file in `worker/migrations/` (for example `0002_add_x.sql`). A test (`server/test/schema.test.ts`) fails if the two schemas differ.

## Option 2: Node server

Use this to self-host, for example on a university or departmental virtual machine, or on a platform such as Render or Fly.io.

- **Docker with PostgreSQL:** `docker compose up -d --build`, then open port 3000. Put it behind a reverse proxy with HTTPS that passes WebSocket upgrades through. The Dockerfile has not been tested yet.
- **Without Docker:** `npm install && npm run build && WEB_DIR=web/dist npm start`.
- **Platforms with temporary disks** (most managed hosts): set `DATABASE_URL` to a PostgreSQL connection string, for example from Neon. SQLite files would be lost on restart.

The Node version keeps live event state in one process, so run a single instance.

### Configuration reference (Node)

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

## Before using it with students

Check your institution's rules for third-party tools that process student data. In the UK this often means a data protection impact assessment. On Cloudflare, the data sits in your Cloudflare account, in the region you chose when creating the D1 database. Whoever runs the service is responsible for the privacy notice.

# Architecture

## Overview

```
Browser (React)  ──REST──▶  Fastify API  ──Kysely──▶  SQLite or PostgreSQL
       ▲  │                      │
       │  └──── WebSocket ──▶  Hub ──▶ MeetingManager ──▶ meeting engines
       └──────── per-person meeting views, "team changed" notices
```

- **`shared/`** holds code used by both server and browser:
  - domain types (`types.ts`)
  - constants such as INVEST and the Prime Directive
  - retrospective templates and Planning Poker decks
  - poker statistics, and capacity and burndown maths
  - zod validation schemas, under the separate entry point `@sprintwell/shared/schemas` so the web bundle stays small.
- **`server/`** holds the shared server core and the Node adapter (Fastify, `app.ts`):
  - `repo.ts`: all database access. Every team-scoped query filters by team id.
  - `routes/api.ts`: REST endpoints for team data (stories, sprints, charter, actions, risks, members, exports).
  - `realtime/core.ts`: the WebSocket protocol (sign-in, team subscriptions, meeting rooms, flood protection); `realtime/hub.ts` keeps the Node server's connections.
  - `meetings/manager.ts`: loads meetings, runs commands one at a time per meeting, persists state, broadcasts views, runs server-side timers.
  - `meetings/*.ts`: one engine per event type (poker, retro, daily, planning, review, pairing).
- **`web/`** is a React app built with Vite. There are no UI libraries; styles are in `styles.css` with design tokens for light and dark themes.

## Two deployment targets, one core

Most server code is platform-neutral and is shared by both targets:

- **API handlers:** `server/src/routes/api.ts`, written against a small router interface (`router.ts`).
- **Real-time protocol:** `server/src/realtime/core.ts`.
- **Meeting engines and manager:** `server/src/meetings/`.
- **Data layer:** `server/src/repo.ts`.

| | Node (`server/`) | Cloudflare (`worker/`) |
|---|---|---|
| HTTP | Fastify | Hono in a Worker |
| WebSockets | `ws`, one hub for all teams | One `TeamRoom` Durable Object per team, using the Hibernation API |
| Connection state | In memory | WebSocket attachments, so it survives hibernation |
| Server-side timers | `setTimeout` | Durable Object alarms |
| Database | SQLite (better-sqlite3) or PostgreSQL | D1, through `kysely-d1`. D1 has no interactive transactions, so grouped writes run in sequence |
| Static files | `@fastify/static` | Workers static assets (single-page-app fallback, `_headers` for security headers) |

On Cloudflare, the Worker is stateless. It handles REST calls and forwards `/ws?team=…` to that team's Durable Object. After changing data, it tells the Durable Object (`/notify`, `/revoke`, `/forget-meeting`, `/forget-team`), which pushes the update to the team's connections. Only the Durable Object writes meeting state, so commands for a meeting are always handled in one place.

The same API and WebSocket test suite runs against both targets, plus PostgreSQL.

## Real-time model

- **The server is authoritative.** Clients send commands such as `{ type: 'vote', value: '5' }` over the WebSocket.
- **Each command runs in turn.** The manager queues commands per meeting, applies them to a copy of the state, saves the new state and sends every participant *their own* view.
- **Per-person views protect privacy:**
  - Planning Poker votes are left out of other people's views until they are revealed.
  - During silent writing, other people's retrospective cards appear only as counts.
  - In anonymous retrospectives, the author is never sent to the browser.
- **Team data (backlog, sprints, actions…) goes through REST.** After each change the server sends a small `team` notice, and subscribed browsers reload the team snapshot (debounced).
- **Timers are timestamps.** The server stores `endsAt`, and clients count down using the server clock offset. Only the pairing timer needs a server-side timeout, to rotate roles automatically.

## Identity

- **Version 1 is anonymous.** `POST /api/session` creates a user with a display name and returns a random token. The browser keeps the token in `localStorage`; the database stores only its SHA-256 hash.
- **Other devices** get a short-lived, one-time sign-in code (`device_links`).
- **Email sign-in is planned.** `users.email` already exists. A magic-link flow would attach an email to an existing user, so nobody loses their history.

## Database

- **One portable schema for both databases.** Migrations are written with Kysely's schema builder (`server/src/db/migrations.ts`), so the same code runs on SQLite and PostgreSQL.
- **Column types are chosen for portability.** Ids are text and timestamps are ISO-8601 text. Nested structures (acceptance criteria, tasks, meeting state) are stored as JSON text.
- **Migrations run on start-up.** To change the schema, add a new migration; never edit one that has shipped.

## Limits and abuse protection

- **Input sizes:** limits are set in `shared/src/constants.ts` (`LIMITS`) and enforced by zod schemas.
- **Per-team caps:** stories, actions, risks, sprints, events and charter items.
- **Rate limits:** a global HTTP limit per IP, stricter limits on session creation and joining, and a per-connection token bucket on the WebSocket.
- **Security headers:** a Content Security Policy that allows `https:` connections so the browser can reach a team's own GitLab, frame blocking and the other headers `@fastify/helmet` sets.
- **Exports:** CSV cells are protected against spreadsheet formula injection, and Markdown summaries escape user text.

## GitLab, classes and the activity log (0.3)

- **Sign in with GitLab** (`server/src/gitlab/auth.ts`): OAuth 2 authorisation code flow with PKCE. Each sign-in is tied to the browser that started it (a nonce kept in browser storage) and to the profile that started it. Signing in asks only for `read_user`; the `api` scope, needed for sync, is a separate step. Tokens are encrypted with AES-256-GCM (`server/src/crypto.ts`) using `SPRINTWELL_SECRET` and refreshed when they are about to expire.
- **GitLab sync** (`server/src/gitlab/sync.ts`): runs on request, as the person who asked. It reads milestones, issues changed since the last sync and project events, with fixed page limits so one request stays within the Cloudflare free plan (50 external requests); cursors let the next sync continue. Estimates are pushed when saved (REST edits and, through `MeetingManager`'s `onEstimate` hook, Planning Poker), as the issue weight if GitLab keeps it, otherwise as a `points::N` label. `server/test/mock-gitlab.ts` imitates the parts of GitLab's API that Sprintwell uses.
- **Classes** (`server/src/classes.ts`): teaching staff are not team members. `Repo.access()` returns `coach` for them; the API lets coaches read everything and manage membership, but not change team work, and the real-time layer lets them watch events without counting as present.
- **Activity log** (`server/src/activity.ts`, `server/src/meetings/activity.ts`): one row per action, written after the action succeeds; a unique `dedupe` key stops repeats (one "voted" per item and round, one row per GitLab event). Logging failures never break the action. What the log must never reveal is listed at the top of `meetings/activity.ts`.
- **Database changes** are Kysely migrations `002`–`006`; `worker/scripts/generate-migration.ts` writes the matching D1 files.

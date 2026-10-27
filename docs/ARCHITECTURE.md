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
- **`server/`** is a Fastify app (`app.ts`):
  - `repo.ts`: all database access. Every team-scoped query filters by team id.
  - `routes/api.ts`: REST endpoints for team data (stories, sprints, charter, actions, risks, members, exports).
  - `realtime/hub.ts`: WebSocket connections, team subscriptions, meeting rooms, flood protection.
  - `meetings/manager.ts`: loads meetings, runs commands one at a time per meeting, persists state, broadcasts views, runs server-side timers.
  - `meetings/*.ts`: one engine per event type (poker, retro, daily, planning, review, pairing).
- **`web/`** is a React app built with Vite. There are no UI libraries; styles are in `styles.css` with design tokens for light and dark themes.

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

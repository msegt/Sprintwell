# Sprintwell

Sprintwell is a free, open-source web app that Agile teams use to run their own Scrum events. Everything happens in real time, in the browser, with no installs and no accounts needed to start.

It was designed around how Scrum (2020 Scrum Guide) and Extreme Programming practices are taught on the MSc module CMT651 Agile Software Development at Cardiff University. It is meant to be just as useful to any other team.

> **Status: early version (0.2).** All the core features work and have automated tests, but it has not yet been used by real teams. Expect rough edges.

**Hosting:** Sprintwell runs on Cloudflare's free plan with no server to look after (Workers, Durable Objects and D1), or as a normal Node.js server. See **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## What teams get

| Area | What it does |
|---|---|
| **Planning Poker** | Votes stay hidden until the facilitator reveals them. After the reveal it shows the distribution, median and mean, and names the lowest and highest voters so they explain first. There is optional auto-reveal and an observer mode. Five decks are built in (Fibonacci, modified Fibonacci, 1–13 story weights, T-shirt sizes, powers of two). Final estimates are written back to the stories, with a hint to split big ones. |
| **Retrospectives** | Ten formats: Start/Stop/Continue, Mad/Sad/Glad, 4Ls, Sailboat, Starfish, KALM, Plus/Delta, Went well/To improve/Ideas, Pre-mortem and Lean Coffee, plus custom columns. The steps are check-in (with the Prime Directive and an anonymous ESVP safety check), review previous actions, silent writing with hidden cards, grouping (keyboard accessible), dot voting, discussion with notes and owned actions, and a return-on-time-invested rating to close. Cards are anonymous by default. |
| **Sprint Planning** | Sets the Sprint Goal (Why) with guidance on what makes a good one. Picks stories against capacity and velocity (What), including focus hours per person and over-commitment warnings. Breaks stories into tasks (How), then starts the sprint (Confirm). |
| **Daily Scrum** | Puts the Sprint Goal on screen and shuffles the speaking order. Each person gets a timer and writes an update against the three Sprint Goal questions beforehand. Blockers can be recorded as impediments, and there is a list for conversations after the Daily Scrum. |
| **Sprint Review** | Shows done and not-done work for the increment, with a "Sprint Goal met?" record. Stakeholder feedback goes straight into the Product Backlog, and the sprint is closed with unfinished work returned to the backlog. |
| **Pairing timer** | Rotates roles in driver/navigator, strong-style, ping-pong or mob programming, with automatic hand-over. |
| **Product Backlog** | User stories written as "As a… I want… so that…", with acceptance criteria and tasks. Each story has an INVEST self-check and a Definition of Ready checklist. You can bulk-add stories, import open issues from GitLab in the browser, and export a CSV that GitLab can import. |
| **Sprint board** | To do, in progress and done columns, a burndown chart and velocity history. |
| **Team charter** | Working agreement, Definition of Ready and Definition of Done as living, printable lists. |
| **Actions and impediments** | Owners, due dates and links back to the event they came from. Retrospectives open by reviewing them. |
| **Risk register** | Likelihood × impact heat map, with legal, ethical, social, professional, security and technical categories, countermeasures, owners and status. |
| **Facilitation** | Every event has a shared timer, presence, a step-by-step flow, hand-over or take-over of the facilitator role (so it can rotate), and a Markdown summary export. |
| **Built-in guidance** | Every page and event has a short "How this works" panel. During events, a hint bar tells the facilitator and everyone else what to do in the current step, with a suggested timebox and a one-click timer. New teams get a Getting started checklist, and `/guide` gathers everything on one page you can link from a course site. |
| **Data** | Full team export as JSON, personal data export and deletion. No tracking. |

Accessibility is a design goal, not an add-on. Everything works from the keyboard, nothing relies on colour alone, step changes and reveals are announced to screen readers, reduced-motion settings are respected and there is a dark mode. End-to-end tests run axe-core on the main pages and events and fail on any serious or critical WCAG 2.1 AA violation. Automated checks only catch some kinds of problem, so testing with real assistive-technology users is still needed.

## How it compares with Parabol

[Parabol](https://www.parabol.co/) is a mature, well-funded product, and Sprintwell is not trying to match it feature for feature. The differences are deliberate:

- **No usage limits.** Parabol's free plan is limited to 2 teams, 10 meetings a month and 30 days of history (per its pricing page in October 2026). Sprintwell has no such limits, which matters for a class with several student teams meeting every week.
- **It teaches as well as records.** INVEST and the Definition of Ready live on every story, and the Prime Directive, Sprint Goal guidance and capacity tips appear inside the events.
- **It covers the whole Scrum cycle.** That includes a backlog, sprint board, risk register and team charter, not only meetings.
- **It works with self-managed GitLab.** Your browser reads the issues directly, so VPN-only university servers such as `git.cardiff.ac.uk` can still work. In Parabol, self-managed GitLab is an Enterprise feature.
- **Exports suit reflective portfolios.** Meeting summaries download as Markdown.

What Parabol has and Sprintwell does not (yet): email accounts and SSO, two-way Jira/GitHub/GitLab sync, AI summaries, team health checks, many more templates, SOC 2 compliance and a professionally run hosted service.

## Quick start (local)

You need Node.js 22 or newer.

```bash
npm install
npm run dev          # Node version: API on :3000, web app on http://localhost:5173
npm run dev:cf       # Cloudflare version in the local Workers runtime: http://localhost:8787
```

By default, the Node version stores data in a SQLite file at `server/data/sprintwell.db`. To use PostgreSQL, set `DATABASE_URL=postgres://…`.

To put it online on Cloudflare's free plan, see **[docs/DEPLOY.md](docs/DEPLOY.md)**. The short version is `npx wrangler login`, then `npx wrangler d1 create sprintwell`, then `npm run deploy:cf`.

## Tests

```bash
npm run typecheck
npm test                 # shared logic and server API/WebSocket tests on SQLite
npm run test:pg          # the same server tests on PostgreSQL
npm run test:cf          # the same API/WebSocket tests against the Cloudflare version (start it first, see docs/DEPLOY.md)
npm run build && npm run test:e2e   # multi-user browser tests and accessibility checks
```

`npm run test:pg` needs a PostgreSQL user that can create databases. It reads `SPRINTWELL_TEST_PG`, which defaults to `postgres://sprintwell:sprintwell@localhost:5432/sprintwell_test`.

To run the browser tests against the Cloudflare version, set `E2E_BASE_URL=http://127.0.0.1:8787` while it is running.

## Project layout

```
shared/   Domain types, retrospective templates, poker decks and statistics, validation schemas
server/   Platform-neutral core (API handlers, real-time protocol, meeting engines, Kysely data layer)
          plus the Node adapter (Fastify, ws, SQLite and PostgreSQL)
worker/   Cloudflare adapter: Worker (API and static files), TeamRoom Durable Object, D1 migrations
web/      React app (Vite)
e2e/      Playwright end-to-end and accessibility tests
docs/     Deployment, architecture and roadmap
```

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Plans, including the free and paid split, are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Using Sprintwell with students

- Each team creates its own space and shares the invite link. The lecturer can join each team with the same link to follow along.
- Accounts are anonymous: a display name and a token stored in the browser. People can sign in on a second device with a one-time code from their profile.
- Before using a hosted copy with a class, check your institution's rules on third-party tools that process student data. In the UK this often means a data protection impact assessment. The privacy page in the app describes what is stored, but whoever runs the server is responsible for the privacy notice.

## Licence

Copyright © 2026 Maria Galvez Trigo.

Licensed under the GNU Affero General Public License v3.0 only (see [LICENSE](LICENSE)). The bundled typefaces, Inter and Bricolage Grotesque (via Fontsource), are licensed under the SIL Open Font License 1.1. Anyone can run, study, change and share Sprintwell. Anyone who runs a modified version as a network service must offer its source code to that service's users; set `SOURCE_URL` so the app links to it.

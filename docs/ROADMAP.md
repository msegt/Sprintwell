# Roadmap

This is a working plan, not a commitment. Priorities should follow what teams actually ask for once they use it.

## Now (0.2)

- Planning Poker, retrospectives (ten formats plus custom), Sprint Planning, Daily Scrum, Sprint Review, pairing timer
- Product Backlog with INVEST and the Definition of Ready, sprint board, burndown, velocity
- Team charter, actions and impediments, risk register
- Anonymous identity with sign-in codes for other devices; exports; personal data deletion
- SQLite and PostgreSQL; Docker; automated tests on both databases; accessibility checks
- Runs on Cloudflare's free plan (Workers, Durable Objects, D1) as well as Node

## Next (free core)

- **Email sign-in (magic links).** Optional, and attaches to the existing anonymous identity. Needed for recovering an account and for any paid plan.
- **Team health check.** For example the Spotify squad health check model, with trends across sprints.
- **More retrospective activities.** Timeline, a "Kudos" round, and random activity picking (as Retromat does).
- **Story splitting helper.** Splitting patterns (workflow steps, business rules, data variations…) suggested when an estimate is large.
- **Welsh and Spanish translations.**
- **Asynchronous retrospectives and stand-ups.** For teams in different time zones.
- **Drag-and-drop grouping.** In addition to the current keyboard-accessible "Group with…" control.
- **Horizontal scaling for the Node version.** Through PostgreSQL `LISTEN/NOTIFY`, so more than one server instance can run. The Cloudflare version already spreads teams across Durable Objects.

## Possible paid tier ("Sprintwell Plus", for the hosted service)

The open-source core should stay complete and free, including for education. Paid features should be things that cost money to run, or that organisations specifically need:

| Candidate | Why it could be paid |
|---|---|
| Two-way sync with GitLab, GitHub and Jira (estimates, status, sprint membership) | Ongoing maintenance of integrations; webhooks |
| Educator / organisation spaces: see many teams at once, compare velocity and actions, export for marking | Mainly valuable to institutions |
| Single sign-on (SAML or OIDC), domain-restricted teams, organisation admin | Enterprise requirement |
| AI assistance: grouping suggestions, retrospective summaries, story-splitting prompts | Model costs per use |
| Longer analytics: team health and velocity trends across terms | Storage and compute |
| Custom branding, data residency, support agreements | Organisational need |

### Things to settle before charging

- **Intellectual property.** If Sprintwell is built as part of university employment, check the employer's IP policy before monetising it or assigning copyright.
- **Accounts and payments.** A merchant-of-record service such as Paddle or Lemon Squeezy, or Stripe Tax, handles UK VAT and international sales taxes. This is simpler than doing it yourself as a sole trader.
- **Privacy and legal terms.** A proper privacy notice and terms of service, a data processing agreement for institutions, and records of where data is hosted.
- **AGPL implications.** Anyone may run their own copy, including commercially. What a paid hosted service sells is convenience, reliability and organisation features. Keeping paid features in a separate closed module would need care; dual licensing needs every contributor to sign a contributor licence agreement (CLA).

## Donations (now)

Set `DONATION_URL` (for example GitHub Sponsors, Ko-fi or Open Collective). The Support page links to it.

import { defineConfig } from '@playwright/test';

const PORT = 3200;
export const MOCK_GITLAB_PORT = 4010;
// Set E2E_BASE_URL to test an already running server instead, e.g. the
// Cloudflare version under `wrangler dev` (see docs/DEPLOY.md).
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: external ?? `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: external
    ? undefined
    : [
        {
          // A stand-in for GitLab, so "Sign in with GitLab" and sync can be tested offline.
          command: `npx tsx server/test/mock-gitlab.ts ${MOCK_GITLAB_PORT}`,
          url: `http://127.0.0.1:${MOCK_GITLAB_PORT}/__mock/health`,
          reuseExistingServer: false,
        },
        {
          // Runs the production build against a throwaway SQLite database.
          command: `node e2e/serve.mjs`,
          url: `http://localhost:${PORT}/healthz`,
          reuseExistingServer: false,
          env: {
            PORT: String(PORT),
            // Token-only GitLab (no OAuth application), as on git.cardiff.ac.uk.
            GITLAB_URL: `http://127.0.0.1:${MOCK_GITLAB_PORT}`,
            SPRINTWELL_SECRET: 'e2e-secret-that-is-long-enough',
          },
        },
      ],
});

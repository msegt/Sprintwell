import { defineConfig } from '@playwright/test';

const PORT = 3200;
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
    : {
    // Runs the production build against a throwaway SQLite database.
    command: `node e2e/serve.mjs`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
  },
});

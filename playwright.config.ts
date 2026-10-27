import { defineConfig } from '@playwright/test';

const PORT = 3200;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    // Runs the production build against a throwaway SQLite database.
    command: `node e2e/serve.mjs`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
  },
});

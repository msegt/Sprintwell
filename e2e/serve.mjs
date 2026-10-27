// Starts the built server with a fresh temporary database for end-to-end tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sprintwell-e2e-'));
process.env.DATABASE_URL = process.env.E2E_DATABASE_URL || join(dir, 'e2e.db');
process.env.WEB_DIR = new URL('../web/dist', import.meta.url).pathname;
process.env.LOG_LEVEL = 'warn';
process.env.SPRINTWELL_DISABLE_RATE_LIMIT = '1';
await import('../server/dist/index.js');

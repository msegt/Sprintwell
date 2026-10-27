import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app, db } = await buildApp(config);

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
app.log.info(`Sprintwell listening on ${config.host}:${config.port} using ${db.dialect}`);

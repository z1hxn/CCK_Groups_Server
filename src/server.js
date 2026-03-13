import { createApp } from './app.js';
import { CONFIG } from './config/env.js';
import { bootstrapDatabase, getDbBootstrapErrorMessage, getDbPoolOrRespond, getPool } from './db/pool.js';

const app = createApp({
  config: CONFIG,
  getPool,
  getDbPoolOrRespond,
  getDbBootstrapErrorMessage,
});

const run = async () => {
  const ok = await bootstrapDatabase(CONFIG.mysql);
  if (!ok) {
    console.error(
      '[CCK_Groups_Server] DB bootstrap failed. Starting in degraded mode:',
      getDbBootstrapErrorMessage(),
    );
  }

  app.listen(CONFIG.port, () => {
    console.log(`[CCK_Groups_Server] listening on http://localhost:${CONFIG.port}`);
    console.log(`[CCK_Groups_Server] ranking proxy target: ${CONFIG.rankingApiUrl}`);
    console.log(`[CCK_Groups_Server] payment proxy target: ${CONFIG.paymentApiUrl}`);
    console.log(
      getPool()
        ? `[CCK_Groups_Server] mysql target: ${CONFIG.mysql.host}:${CONFIG.mysql.port}/${CONFIG.mysql.database}`
        : `[CCK_Groups_Server] mysql unavailable: ${CONFIG.mysql.host}:${CONFIG.mysql.port}/${CONFIG.mysql.database}`,
    );
  });
};

run();

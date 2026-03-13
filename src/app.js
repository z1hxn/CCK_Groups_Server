import cors from 'cors';
import express from 'express';
import { createAdminRouter } from './routes/admin.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import { createCompetitionRouter } from './routes/competition.routes.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createPlayerRouter } from './routes/player.routes.js';

export const createApp = ({ config, getPool, getDbPoolOrRespond, getDbBootstrapErrorMessage }) => {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.use(createHealthRouter({ config, getPool, getDbBootstrapErrorMessage }));
  app.use(createAuthRouter({ config }));
  app.use(createPlayerRouter({ config, getDbPoolOrRespond }));
  app.use(createAdminRouter({ config, getDbPoolOrRespond }));
  app.use(createCompetitionRouter({ config }));

  return app;
};

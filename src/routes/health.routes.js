import { Router } from 'express';

export const createHealthRouter = ({ config, getPool, getDbBootstrapErrorMessage }) => {
  const router = Router();

  router.get(['/api/v1/health', '/api/health'], async (_req, res) => {
    const pool = getPool();
    if (!pool) {
      return res.json({
        service: 'cck-groups-server',
        status: 'degraded',
        rankingApiUrl: config.rankingApiUrl,
        paymentApiUrl: config.paymentApiUrl,
        loginUrl: config.loginUrl,
        mysql: {
          host: config.mysql.host,
          port: config.mysql.port,
          database: config.mysql.database,
          status: 'unavailable',
          detail: getDbBootstrapErrorMessage(),
        },
      });
    }

    try {
      await pool.query('SELECT 1');
      return res.json({
        service: 'cck-groups-server',
        status: 'ok',
        rankingApiUrl: config.rankingApiUrl,
        paymentApiUrl: config.paymentApiUrl,
        loginUrl: config.loginUrl,
        mysql: {
          host: config.mysql.host,
          port: config.mysql.port,
          database: config.mysql.database,
        },
      });
    } catch (error) {
      return res.status(500).json({ message: 'DB connection failed', detail: String(error) });
    }
  });

  return router;
};

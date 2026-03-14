import { Router } from 'express';
import { proxyAuthJson } from '../utils/http.js';

export const createAuthRouter = ({ config }) => {
  const router = Router();

  router.post(['/api/v1/auth/token', '/api/auth/token'], async (req, res) => {
    const code = String(req.query.code || '');
    if (!code) return res.status(400).json({ message: 'Missing code' });

    const result = await proxyAuthJson(req, `${config.rankingApiUrl}/auth/token?code=${encodeURIComponent(code)}`, {
      method: 'POST',
    });
    if (result.setCookieHeaders.length > 0) {
      res.setHeader('Set-Cookie', result.setCookieHeaders);
    }
    return res.status(result.status).json(result.data ?? {});
  });

  router.post(['/api/v1/auth/refresh', '/api/auth/refresh'], async (req, res) => {
    const result = await proxyAuthJson(req, `${config.rankingApiUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body ?? {}),
    });
    if (result.setCookieHeaders.length > 0) {
      res.setHeader('Set-Cookie', result.setCookieHeaders);
    }
    return res.status(result.status).json(result.data ?? {});
  });

  router.post(['/api/v1/auth/logout', '/api/auth/logout'], async (req, res) => {
    const authHeader = req.headers.authorization;
    const result = await proxyAuthJson(req, `${config.rankingApiUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
    });
    if (result.setCookieHeaders.length > 0) {
      res.setHeader('Set-Cookie', result.setCookieHeaders);
    }
    return res.status(result.status).json(result.data ?? {});
  });

  router.get(['/api/v1/auth/info/:cckId', '/api/auth/info/:cckId'], async (req, res) => {
    const cckId = String(req.params.cckId || '').trim().toLowerCase();
    if (!cckId) return res.status(400).json({ message: 'Invalid cckId' });

    const result = await proxyAuthJson(req, `${config.rankingApiUrl}/auth/info/${encodeURIComponent(cckId)}`);
    return res.status(result.status).json(result.data ?? {});
  });

  router.get(['/api/v1/auth/info', '/api/auth/info'], async (req, res) => {
    const authHeader = req.headers.authorization;
    const result = await proxyAuthJson(req, `${config.rankingApiUrl}/auth/info`, {
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });
    return res.status(result.status).json(result.data ?? {});
  });

  return router;
};

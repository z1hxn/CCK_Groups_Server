import { Router } from 'express';
import { extractListPayload, extractObjectPayload, proxyJson } from '../utils/http.js';
import { toCompetition, toConfirmedRegistration, toRound } from '../utils/mappers.js';

export const createCompetitionRouter = ({ config }) => {
  const router = Router();

  router.get('/api/competitions', async (req, res) => {
    const status = String(req.query.status || 'now');
    if (!['past', 'now', 'future'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Use one of: past, now, future' });
    }
    const endpoint = status === 'past' ? '/comp/past' : status === 'future' ? '/comp/future' : '/comp/now';

    const result = await proxyJson(`${config.rankingApiUrl}${endpoint}`);
    if (!result.ok) {
      return res.status(result.status).json({ message: 'Failed to fetch competitions', upstream: result.data });
    }

    const raw = extractListPayload(result.data);
    return res.json({ status, data: raw.map(toCompetition), source: 'ranking-api' });
  });

  router.get('/api/competitions/:competitionId', async (req, res) => {
    const competitionId = Number(req.params.competitionId);
    if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

    const compResult = await proxyJson(`${config.rankingApiUrl}/comp/${competitionId}`);
    if (!compResult.ok) {
      return res.status(compResult.status).json({ message: 'Failed to fetch competition detail', upstream: compResult.data });
    }

    const compPayload = extractObjectPayload(compResult.data);
    if (!compPayload) {
      return res.status(502).json({ message: 'Invalid competition payload', upstream: compResult.data });
    }

    const start = new Date(compPayload.compDateStart);
    const end = new Date(compPayload.compDateEnd);
    const dayResults = [];

    if (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())) {
      let dayCount = 0;
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());

      while (cursor <= last) {
        dayResults.push(proxyJson(`${config.rankingApiUrl}/round/${competitionId}/day-count/${dayCount}`));
        cursor.setDate(cursor.getDate() + 1);
        dayCount += 1;
      }
    }

    const roundDayResponses = await Promise.all(dayResults);
    const allRoundsRaw = roundDayResponses.flatMap((responseItem) => {
      const past = extractListPayload(responseItem.data?.past ?? responseItem.data?.data?.past);
      const now = extractListPayload(responseItem.data?.now ?? responseItem.data?.data?.now);
      const future = extractListPayload(responseItem.data?.future ?? responseItem.data?.data?.future);
      return [...past, ...now, ...future];
    });

    const uniqueMap = new Map();
    for (const round of allRoundsRaw) {
      uniqueMap.set(round.idx, round);
    }

    const rounds = [...uniqueMap.values()]
      .map(toRound)
      .sort((a, b) => new Date(a.eventStart).getTime() - new Date(b.eventStart).getTime());

    return res.json({
      data: {
        ...toCompetition(compPayload),
        rounds,
      },
      source: 'ranking-api',
    });
  });

  router.get('/api/competitions/:competitionId/rounds/day/:dayCount', async (req, res) => {
    const competitionId = Number(req.params.competitionId);
    const dayCount = Number(req.params.dayCount);
    if (!Number.isFinite(competitionId) || !Number.isFinite(dayCount)) {
      return res.status(400).json({ message: 'Invalid parameters' });
    }

    const result = await proxyJson(`${config.rankingApiUrl}/round/${competitionId}/day-count/${dayCount}`);
    if (!result.ok) {
      return res.status(result.status).json({ message: 'Failed to fetch round schedule', upstream: result.data });
    }

    const mapList = (list) => extractListPayload(list).map(toRound);
    return res.json({
      data: {
        past: mapList(result.data?.past ?? result.data?.data?.past),
        now: mapList(result.data?.now ?? result.data?.data?.now),
        future: mapList(result.data?.future ?? result.data?.data?.future),
      },
      source: 'ranking-api',
    });
  });

  router.get('/api/competitions/:competitionId/registrations/confirmed', async (req, res) => {
    const competitionId = Number(req.params.competitionId);
    if (!Number.isFinite(competitionId)) {
      return res.status(400).json({ message: 'Invalid competition id' });
    }

    const result = await proxyJson(`${config.paymentApiUrl}/registration/comp/${competitionId}/confirmed`);
    if (!result.ok) {
      return res.status(result.status).json({ message: 'Failed to fetch confirmed registrations', upstream: result.data });
    }

    const raw = extractListPayload(result.data);
    return res.json({
      data: raw.map(toConfirmedRegistration),
      source: 'payment-api',
    });
  });

  return router;
};

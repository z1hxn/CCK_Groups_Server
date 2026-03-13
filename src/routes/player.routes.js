import { Router } from 'express';
import { getConfiguredRoundGroups } from '../utils/roundGroups.js';
import { toGroupAssignments } from '../utils/groups.js';
import { PLAYER_GROUP_TABLES } from '../utils/groupTables.js';
import { extractObjectPayload, proxyJson } from '../utils/http.js';
import { toPlayerGroupRow, toPlayerRoundInfo } from '../utils/mappers.js';

export const createPlayerRouter = ({ config, getDbPoolOrRespond }) => {
  const router = Router();

  router.get('/api/v1/competition/:compIdx/player/:cckId', async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    const cckId = String(req.params.cckId || '').trim();

    if (!Number.isFinite(compIdx)) {
      return res.status(400).json({ message: 'Invalid compIdx' });
    }
    if (!cckId) {
      return res.status(400).json({ message: 'Invalid cckId' });
    }

    const roleRows = {};
    for (const { role, tableName } of PLAYER_GROUP_TABLES) {
      const [rows] = await db.query(
        `SELECT idx, round_idx, cck_id, \`group\`
         FROM \`${tableName}\`
         WHERE cck_id = ?
         ORDER BY idx ASC`,
        [cckId],
      );
      roleRows[role] = Array.isArray(rows) ? rows : [];
    }

    const uniqueRoundIdxs = [...new Set(
      PLAYER_GROUP_TABLES.flatMap(({ role }) => roleRows[role].map((row) => Number(row.round_idx))).filter(Number.isFinite),
    )];

    const roundPayloadByIdx = new Map();
    await Promise.all(
      uniqueRoundIdxs.map(async (roundIdx) => {
        const result = await proxyJson(`${config.rankingApiUrl}/round/${roundIdx}`);
        if (!result.ok) return;
        const roundPayload = extractObjectPayload(result.data);
        if (!roundPayload || !Number.isFinite(Number(roundPayload.compIdx))) return;
        roundPayloadByIdx.set(roundIdx, roundPayload);
      }),
    );

    const data = {};
    for (const { role } of PLAYER_GROUP_TABLES) {
      data[role] = roleRows[role]
        .filter((row) => {
          const roundInfo = roundPayloadByIdx.get(Number(row.round_idx));
          return roundInfo && Number(roundInfo.compIdx) === compIdx;
        })
        .map((row) => toPlayerGroupRow(row, roundPayloadByIdx.get(Number(row.round_idx))));
    }

    return res.json({
      compIdx,
      cckId,
      ...data,
    });
  });

  router.get('/api/v1/round/:roundIdx', async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const roundIdx = Number(req.params.roundIdx);
    if (!Number.isFinite(roundIdx)) {
      return res.status(400).json({ message: 'Invalid roundIdx' });
    }

    const roleRows = {};
    for (const { role, tableName } of PLAYER_GROUP_TABLES) {
      const [rows] = await db.query(
        `SELECT idx, round_idx, cck_id, \`group\`
         FROM \`${tableName}\`
         WHERE round_idx = ?
         ORDER BY \`group\` ASC, cck_id ASC, idx ASC`,
        [roundIdx],
      );
      roleRows[role] = Array.isArray(rows) ? rows : [];
    }

    const roundResult = await proxyJson(`${config.rankingApiUrl}/round/${roundIdx}`);
    const roundPayload = roundResult.ok ? extractObjectPayload(roundResult.data) : null;
    const configured = await getConfiguredRoundGroups(db, roundIdx);
    const configuredGroupNames = configured.map((item) => item.groupName);
    const effectiveRoundPayload = roundPayload
      ? {
          ...roundPayload,
          roundGroupList: configuredGroupNames,
        }
      : null;
    const roleData = {};

    for (const { role } of PLAYER_GROUP_TABLES) {
      roleData[role] = roleRows[role].map((row) => toPlayerGroupRow(row, effectiveRoundPayload));
    }

    return res.json({
      roundIdx,
      round: toPlayerRoundInfo(effectiveRoundPayload),
      ...roleData,
      groups: toGroupAssignments(roleData),
    });
  });

  return router;
};

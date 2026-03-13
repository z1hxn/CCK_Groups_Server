import { Router } from 'express';
import { resolvePlayerTableName } from '../utils/groupTables.js';
import { getConfiguredRoundGroups, validateRoundBelongsToCompetition } from '../utils/roundGroups.js';

export const createAdminRouter = ({ config, getDbPoolOrRespond }) => {
  const router = Router();

  const handleRoundGroupConfigUpdate = async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    const roundIdx = Number(req.params.roundIdx);
    if (!Number.isFinite(compIdx)) return res.status(400).json({ message: 'Invalid compIdx' });
    if (!Number.isFinite(roundIdx)) return res.status(400).json({ message: 'Invalid roundIdx' });

    const validation = await validateRoundBelongsToCompetition(config.rankingApiUrl, compIdx, roundIdx);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message, upstream: validation.upstream });
    }

    const requestGroups = Array.isArray(req.body?.groups)
      ? req.body.groups
      : Array.isArray(req.body?.groupList)
        ? req.body.groupList.map((groupName) => ({
            groupName,
            playerCount: 0,
            judgeCount: 0,
            runnerCount: 0,
            scramblerCount: 0,
          }))
        : [];

    const groupMap = new Map();
    for (const item of requestGroups) {
      const groupName = String(item?.groupName ?? item ?? '').trim();
      if (!groupName) continue;
      const playerCount = Math.max(0, Number(item?.playerCount) || 0);
      const judgeCount = Math.max(0, Number(item?.judgeCount) || 0);
      const runnerCount = Math.max(0, Number(item?.runnerCount) || 0);
      const scramblerCount = Math.max(0, Number(item?.scramblerCount) || 0);
      groupMap.set(groupName, { groupName, playerCount, judgeCount, runnerCount, scramblerCount });
    }
    const groups = [...groupMap.values()].sort((a, b) => a.groupName.localeCompare(b.groupName, 'ko-KR'));

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM round_group WHERE round_idx = ?', [roundIdx]);

      if (groups.length > 0) {
        const rows = groups.map((item) => [
          roundIdx,
          item.groupName,
          item.playerCount,
          item.judgeCount,
          item.runnerCount,
          item.scramblerCount,
        ]);
        await conn.query(
          `INSERT INTO round_group (round_idx, group_name, player_count, judge_count, runner_count, scrambler_count)
           VALUES ?`,
          [rows],
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    return res.json({
      data: {
        compIdx,
        roundIdx,
        groups,
        groupList: groups.map((item) => item.groupName),
        updated: true,
      },
    });
  };

  const handlePlayerAssignmentUpdate = async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    const cckId = String(req.body?.cckId || '').trim();
    const role = String(req.body?.role || '').trim();
    const roundIdx = Number(req.body?.roundIdx);
    const requestGroups = Array.isArray(req.body?.groups)
      ? req.body.groups
      : req.body?.group == null
        ? []
        : [req.body.group];

    if (!Number.isFinite(compIdx)) {
      return res.status(400).json({ message: 'Invalid compIdx' });
    }
    if (!cckId) {
      return res.status(400).json({ message: 'Invalid cckId' });
    }
    if (!Number.isFinite(roundIdx)) {
      return res.status(400).json({ message: 'Invalid roundIdx' });
    }

    const tableName = resolvePlayerTableName(role);
    if (!tableName) {
      return res.status(400).json({ message: 'Invalid role. Use one of: competition, judge, runner, scrambler' });
    }
    const groups = [...new Set(
      requestGroups
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    )];
    if (role === 'competition' && groups.length > 1) {
      return res.status(400).json({ message: 'competition role supports only one group' });
    }

    const validation = await validateRoundBelongsToCompetition(config.rankingApiUrl, compIdx, roundIdx);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message, upstream: validation.upstream });
    }

    await db.query(
      `DELETE FROM \`${tableName}\`
       WHERE cck_id = ? AND round_idx = ?`,
      [cckId, roundIdx],
    );

    if (groups.length > 0) {
      const rows = groups.map((group) => [roundIdx, cckId, group]);
      await db.query(
        `INSERT INTO \`${tableName}\` (round_idx, cck_id, \`group\`)
         VALUES ?`,
        [rows],
      );
    }

    return res.json({
      data: {
        compIdx,
        cckId,
        role,
        roundIdx,
        groups,
        updated: true,
      },
    });
  };

  const sendRoundConfig = async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    const roundIdx = Number(req.params.roundIdx);
    if (!Number.isFinite(compIdx)) return res.status(400).json({ message: 'Invalid compIdx' });
    if (!Number.isFinite(roundIdx)) return res.status(400).json({ message: 'Invalid roundIdx' });

    const validation = await validateRoundBelongsToCompetition(config.rankingApiUrl, compIdx, roundIdx);
    if (!validation.ok) {
      return res.status(validation.status).json({ message: validation.message, upstream: validation.upstream });
    }

    const groups = await getConfiguredRoundGroups(db, roundIdx);
    return res.json({
      data: {
        compIdx,
        roundIdx,
        groups,
        groupList: groups.map((item) => item.groupName),
        source: 'db',
      },
    });
  };

  router.get('/api/admin/competition/:compIdx/round/:roundIdx/config', sendRoundConfig);
  router.get('/api/admin/competition/:compIdx/round/:roundIdx/configs', sendRoundConfig);

  router.put('/api/admin/competition/:compIdx/round/:roundIdx/config', handleRoundGroupConfigUpdate);
  router.post('/api/admin/competition/:compIdx/round/:roundIdx/config', handleRoundGroupConfigUpdate);
  router.put('/api/admin/competition/:compIdx/round/:roundIdx/configs', handleRoundGroupConfigUpdate);
  router.post('/api/admin/competition/:compIdx/round/:roundIdx/configs', handleRoundGroupConfigUpdate);

  router.post('/api/admin/competition/:compIdx/player-assignment', handlePlayerAssignmentUpdate);
  router.post('/api/admin/competitions/:compIdx/player-assignment', handlePlayerAssignmentUpdate);
  router.post('/api/v1/admin/competition/:compIdx/player-assignment', handlePlayerAssignmentUpdate);

  return router;
};

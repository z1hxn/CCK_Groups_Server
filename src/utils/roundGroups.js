import { extractObjectPayload, proxyJson } from './http.js';

export const validateRoundBelongsToCompetition = async (rankingApiUrl, compIdx, roundIdx) => {
  const roundResult = await proxyJson(`${rankingApiUrl}/round/${roundIdx}`);
  if (!roundResult.ok) {
    return {
      ok: false,
      status: roundResult.status,
      message: 'Failed to validate round',
      upstream: roundResult.data,
    };
  }

  const roundPayload = extractObjectPayload(roundResult.data);
  if (!roundPayload || Number(roundPayload.compIdx) !== compIdx) {
    return {
      ok: false,
      status: 400,
      message: 'roundIdx does not belong to compIdx',
      upstream: roundResult.data,
    };
  }

  return {
    ok: true,
    roundPayload,
  };
};

export const getConfiguredRoundGroups = async (db, roundIdx) => {
  const [rows] = await db.query(
    `SELECT idx, round_idx, group_name, player_count, judge_count, runner_count, scrambler_count
     FROM round_group
     WHERE round_idx = ?
     ORDER BY group_name ASC, idx ASC`,
    [roundIdx],
  );

  if (!Array.isArray(rows) || rows.length === 0) return [];

  return rows
    .map((row) => ({
      idx: Number(row.idx),
      roundIdx: Number(row.round_idx),
      groupName: String(row.group_name || '').trim(),
      playerCount: Math.max(0, Number(row.player_count) || 0),
      judgeCount: Math.max(0, Number(row.judge_count) || 0),
      runnerCount: Math.max(0, Number(row.runner_count) || 0),
      scramblerCount: Math.max(0, Number(row.scrambler_count) || 0),
    }))
    .filter((row) => row.groupName);
};

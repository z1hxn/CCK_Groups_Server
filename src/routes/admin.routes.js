import { Router } from 'express';
import { PLAYER_GROUP_TABLES, resolvePlayerTableName } from '../utils/groupTables.js';
import { getConfiguredRoundGroups, validateRoundBelongsToCompetition } from '../utils/roundGroups.js';
import { extractListPayload, extractObjectPayload, proxyJson } from '../utils/http.js';
import { toConfirmedRegistration } from '../utils/mappers.js';

export const createAdminRouter = ({ config, getDbPoolOrRespond }) => {
  const router = Router();
  const normalizeEventName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const shuffle = (items) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const getCompetitionRoundIdxs = async (compIdx) => {
    const compResult = await proxyJson(`${config.rankingApiUrl}/comp/${compIdx}`);
    if (!compResult.ok) {
      return {
        ok: false,
        status: compResult.status,
        message: 'Failed to fetch competition detail',
        upstream: compResult.data,
      };
    }

    const compPayload = extractObjectPayload(compResult.data);
    if (!compPayload) {
      return {
        ok: false,
        status: 502,
        message: 'Invalid competition payload',
        upstream: compResult.data,
      };
    }

    const start = new Date(compPayload.compDateStart);
    const end = new Date(compPayload.compDateEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      return {
        ok: true,
        competitionName: String(compPayload.compName ?? compPayload.name ?? '').trim(),
        roundIdxs: [],
      };
    }

    const dayResults = [];
    let dayCount = 0;
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= last) {
      dayResults.push(proxyJson(`${config.rankingApiUrl}/round/${compIdx}/day-count/${dayCount}`));
      cursor.setDate(cursor.getDate() + 1);
      dayCount += 1;
    }

    const roundDayResponses = await Promise.all(dayResults);
    const allRoundRows = roundDayResponses.flatMap((responseItem) => {
      const past = extractListPayload(responseItem.data?.past ?? responseItem.data?.data?.past);
      const now = extractListPayload(responseItem.data?.now ?? responseItem.data?.data?.now);
      const future = extractListPayload(responseItem.data?.future ?? responseItem.data?.data?.future);
      return [...past, ...now, ...future];
    });
    const roundIdxs = [...new Set(
      allRoundRows
        .map((item) => Number(item?.idx))
        .filter(Number.isFinite),
    )];
    const rounds = allRoundRows
      .map((item) => ({
        idx: Number(item?.idx),
        cubeEventName: String(item?.cubeEventName || '').trim(),
        roundName: String(item?.roundName || '').trim(),
        eventStart: String(item?.eventStart || ''),
      }))
      .filter((item) => Number.isFinite(item.idx))
      .sort((a, b) => new Date(a.eventStart).getTime() - new Date(b.eventStart).getTime());
    const uniqueRounds = [...new Map(rounds.map((item) => [item.idx, item])).values()];

    return {
      ok: true,
      competitionName: String(compPayload.compName ?? compPayload.name ?? '').trim(),
      roundIdxs,
      rounds: uniqueRounds,
    };
  };

  const deleteAssignmentsByRoundIdxs = async (conn, roundIdxs, options = {}) => {
    const includeRoundGroup = Boolean(options.includeRoundGroup);
    if (!Array.isArray(roundIdxs) || roundIdxs.length === 0) {
      return { deletedRows: 0 };
    }

    let deletedRows = 0;
    if (includeRoundGroup) {
      const [roundGroupResult] = await conn.query('DELETE FROM round_group WHERE round_idx IN (?)', [roundIdxs]);
      deletedRows += Number(roundGroupResult?.affectedRows || 0);
    }

    for (const { tableName } of PLAYER_GROUP_TABLES) {
      const [result] = await conn.query(`DELETE FROM \`${tableName}\` WHERE round_idx IN (?)`, [roundIdxs]);
      deletedRows += Number(result?.affectedRows || 0);
    }

    return { deletedRows };
  };

  const getConfirmedRegistrations = async (compIdx) => {
    const result = await proxyJson(`${config.paymentApiUrl}/registration/comp/${compIdx}/confirmed`);
    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        message: 'Failed to fetch confirmed registrations',
        upstream: result.data,
      };
    }

    const raw = extractListPayload(result.data);
    const registrations = raw.map(toConfirmedRegistration).map((item) => ({
      ...item,
      cckId: String(item.cckId || '').trim().toLowerCase(),
      selectedEvents: Array.isArray(item.selectedEvents) ? item.selectedEvents : [],
    }));
    return { ok: true, registrations };
  };

  const getAdminFlagMap = async (cckIds) => {
    const map = new Map();
    await Promise.all(
      cckIds.map(async (cckId) => {
        try {
          const result = await proxyJson(`https://auth.cubingclub.com/api/auth/info/${encodeURIComponent(cckId)}`);
          const payload = extractObjectPayload(result.data) || {};
          const position = String(payload?.position || '').trim().toUpperCase();
          map.set(cckId, position === 'ADMIN');
        } catch {
          map.set(cckId, false);
        }
      }),
    );
    return map;
  };

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

  const handleResetCompetitionAssignments = async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    if (!Number.isFinite(compIdx)) return res.status(400).json({ message: 'Invalid compIdx' });

    const confirmation = String(req.body?.confirmCompetitionName || '').trim();
    if (!confirmation) {
      return res.status(400).json({ message: 'confirmCompetitionName is required' });
    }

    const roundsResult = await getCompetitionRoundIdxs(compIdx);
    if (!roundsResult.ok) {
      return res.status(roundsResult.status).json({ message: roundsResult.message, upstream: roundsResult.upstream });
    }

    const competitionName = String(roundsResult.competitionName || '').trim();
    if (competitionName && confirmation !== competitionName) {
      return res.status(400).json({ message: 'Competition name confirmation mismatch' });
    }

    const roundIdxs = roundsResult.roundIdxs;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const { deletedRows } = await deleteAssignmentsByRoundIdxs(conn, roundIdxs, { includeRoundGroup: true });

      await conn.commit();
      return res.json({
        data: {
          compIdx,
          competitionName,
          roundCount: roundIdxs.length,
          deletedRows,
          reset: true,
        },
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  };

  const handleAutoAssign = async (req, res) => {
    const db = getDbPoolOrRespond(res);
    if (!db) return;

    const compIdx = Number(req.params.compIdx);
    if (!Number.isFinite(compIdx)) return res.status(400).json({ message: 'Invalid compIdx' });

    const confirmation = String(req.body?.confirmCompetitionName || '').trim();
    if (!confirmation) {
      return res.status(400).json({ message: 'confirmCompetitionName is required' });
    }
    const scramblerCandidateSet = new Set(
      (
        Array.isArray(req.body?.scrambler?.candidateCckIds)
          ? req.body.scrambler.candidateCckIds
          : Array.isArray(req.body?.scramblerCandidateCckIds)
            ? req.body.scramblerCandidateCckIds
            : Array.isArray(req.body?.scramblerCckIds)
              ? req.body.scramblerCckIds
              : req.body?.scramblers ?? []
      )
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean),
    );
    const excludedAutoAssignSet = new Set(
      (
        Array.isArray(req.body?.exclusion?.cckIds)
          ? req.body.exclusion.cckIds
          : Array.isArray(req.body?.excludedCckIds)
            ? req.body.excludedCckIds
            : Array.isArray(req.body?.blockedCckIds)
              ? req.body.blockedCckIds
              : req.body?.excluded ?? []
      )
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean),
    );

    const roundsResult = await getCompetitionRoundIdxs(compIdx);
    if (!roundsResult.ok) {
      return res.status(roundsResult.status).json({ message: roundsResult.message, upstream: roundsResult.upstream });
    }
    const competitionName = String(roundsResult.competitionName || '').trim();
    if (competitionName && confirmation !== competitionName) {
      return res.status(400).json({ message: 'Competition name confirmation mismatch' });
    }
    const rounds = Array.isArray(roundsResult.rounds) ? roundsResult.rounds : [];
    if (rounds.length === 0) {
      return res.status(400).json({ message: 'No rounds available for this competition' });
    }

    const registrationsResult = await getConfirmedRegistrations(compIdx);
    if (!registrationsResult.ok) {
      return res.status(registrationsResult.status).json({
        message: registrationsResult.message,
        upstream: registrationsResult.upstream,
      });
    }
    const registrations = registrationsResult.registrations.filter((item) => item.cckId);
    const registrationCckIds = [...new Set(registrations.map((item) => item.cckId))];
    const isAdminByCckId = await getAdminFlagMap(registrationCckIds);

    const playerRows = [];
    const judgeRows = [];
    const runnerRows = [];
    const scramblerRows = [];
    const roundSummaries = [];

    for (const round of rounds) {
      const roundIdx = Number(round.idx);
      if (!Number.isFinite(roundIdx)) continue;

      const groups = await getConfiguredRoundGroups(db, roundIdx);
      if (groups.length === 0) {
        roundSummaries.push({
          roundIdx,
          eventName: round.cubeEventName,
          roundName: round.roundName,
          groupCount: 0,
          skipped: true,
          reason: 'No group config',
        });
        continue;
      }

      const groupState = groups.map((group) => ({
        groupName: group.groupName,
        playerLimit: Math.max(0, Number(group.playerCount) || 0),
        judgeLimit: Math.max(0, Number(group.judgeCount) || 0),
        runnerLimit: Math.max(0, Number(group.runnerCount) || 0),
        scramblerLimit: Math.max(0, Number(group.scramblerCount) || 0),
        players: [],
        judges: [],
        runners: [],
        scramblers: [],
        assignedInGroup: new Set(),
      }));

      const eventName = normalizeEventName(round.cubeEventName);
      const participants = [...new Set(
        registrations
          .filter((item) => {
            if (item.selectedEvents.length === 0) return true;
            return item.selectedEvents.map((eventItem) => normalizeEventName(eventItem)).includes(eventName);
          })
          .map((item) => item.cckId),
      )];

      const shuffledParticipants = shuffle(participants);
      const adminParticipants = shuffledParticipants.filter((cckId) => isAdminByCckId.get(cckId) === true);
      const normalParticipants = shuffledParticipants.filter((cckId) => isAdminByCckId.get(cckId) !== true);

      for (const group of groupState) {
        if (group.playerLimit <= 0) continue;
        const admin = adminParticipants.shift();
        if (!admin) continue;
        group.players.push(admin);
        group.assignedInGroup.add(admin);
      }

      const playerPool = shuffle([...normalParticipants, ...adminParticipants]);
      for (const group of groupState) {
        while (group.players.length < group.playerLimit && playerPool.length > 0) {
          const cckId = playerPool.shift();
          if (!cckId || group.players.includes(cckId)) continue;
          group.players.push(cckId);
          group.assignedInGroup.add(cckId);
        }
      }

      const runnerJudgeCandidateAll = registrationCckIds.filter((cckId) => !excludedAutoAssignSet.has(cckId));
      const runnerJudgeCandidateStrict = runnerJudgeCandidateAll.filter((cckId) => isAdminByCckId.get(cckId) !== true);
      const scramblerCandidatePool = registrationCckIds.filter((cckId) => scramblerCandidateSet.has(cckId));

      const assignGroupWithMatching = (group, runnerJudgeCandidates, usedByRole) => {
        const scramblerEligible = [...new Set(
          scramblerCandidatePool.filter(
            (cckId) => !group.players.includes(cckId) && !usedByRole.scrambler.has(cckId),
          ),
        )];
        const runnerEligible = [...new Set(
          runnerJudgeCandidates.filter((cckId) => !group.players.includes(cckId) && !usedByRole.runner.has(cckId)),
        )];
        const judgeEligible = [...new Set(
          runnerJudgeCandidates.filter((cckId) => !group.players.includes(cckId) && !usedByRole.judge.has(cckId)),
        )];

        const slots = [];
        for (let i = 0; i < group.scramblerLimit; i += 1) {
          slots.push({
            key: `scr-${group.groupName}-${i}`,
            role: 'scrambler',
            eligible: shuffle(scramblerEligible),
          });
        }
        for (let i = 0; i < group.runnerLimit; i += 1) {
          slots.push({
            key: `run-${group.groupName}-${i}`,
            role: 'runner',
            eligible: shuffle(runnerEligible),
          });
        }
        for (let i = 0; i < group.judgeLimit; i += 1) {
          slots.push({
            key: `jud-${group.groupName}-${i}`,
            role: 'judge',
            eligible: shuffle(judgeEligible),
          });
        }

        const slotMap = new Map(slots.map((slot) => [slot.key, slot]));
        const matchByCandidate = new Map();

        const tryMatch = (slotKey, visited) => {
          const slot = slotMap.get(slotKey);
          if (!slot) return false;

          for (const cckId of slot.eligible) {
            if (visited.has(cckId)) continue;
            visited.add(cckId);

            const occupiedSlotKey = matchByCandidate.get(cckId);
            if (!occupiedSlotKey || tryMatch(occupiedSlotKey, visited)) {
              matchByCandidate.set(cckId, slotKey);
              return true;
            }
          }
          return false;
        };

        const orderedSlots = [...slots].sort((a, b) => a.eligible.length - b.eligible.length);
        for (const slot of orderedSlots) {
          tryMatch(slot.key, new Set());
        }

        const assigned = {
          scramblers: [],
          runners: [],
          judges: [],
        };
        for (const [cckId, slotKey] of matchByCandidate.entries()) {
          const slot = slotMap.get(slotKey);
          if (!slot) continue;
          if (slot.role === 'scrambler') assigned.scramblers.push(cckId);
          if (slot.role === 'runner') assigned.runners.push(cckId);
          if (slot.role === 'judge') assigned.judges.push(cckId);
        }

        const totalAssigned = assigned.scramblers.length + assigned.runners.length + assigned.judges.length;
        const totalRequested = group.scramblerLimit + group.runnerLimit + group.judgeLimit;
        const usesAdminInRunnerJudge = [...assigned.runners, ...assigned.judges].some(
          (cckId) => isAdminByCckId.get(cckId) === true,
        );

        return {
          ...assigned,
          totalAssigned,
          totalRequested,
          usesAdminInRunnerJudge,
        };
      };

      let adminFallbackUsed = false;
      const usedByRole = {
        scrambler: new Set(),
        runner: new Set(),
        judge: new Set(),
      };
      for (const group of groupState) {
        const strictResult = assignGroupWithMatching(group, runnerJudgeCandidateStrict, usedByRole);
        let bestResult = strictResult;

        if (strictResult.totalAssigned < strictResult.totalRequested) {
          const fallbackResult = assignGroupWithMatching(group, runnerJudgeCandidateAll, usedByRole);
          if (fallbackResult.totalAssigned > strictResult.totalAssigned) {
            bestResult = fallbackResult;
          }
        }

        group.scramblers = bestResult.scramblers;
        group.runners = bestResult.runners;
        group.judges = bestResult.judges;
        group.assignedInGroup = new Set([...group.players, ...group.scramblers, ...group.runners, ...group.judges]);
        for (const cckId of group.scramblers) usedByRole.scrambler.add(cckId);
        for (const cckId of group.runners) usedByRole.runner.add(cckId);
        for (const cckId of group.judges) usedByRole.judge.add(cckId);

        if (bestResult.usesAdminInRunnerJudge) {
          adminFallbackUsed = true;
        }
      }

      for (const group of groupState) {
        for (const cckId of group.players) playerRows.push([roundIdx, cckId, group.groupName]);
        for (const cckId of group.scramblers) scramblerRows.push([roundIdx, cckId, group.groupName]);
        for (const cckId of group.runners) runnerRows.push([roundIdx, cckId, group.groupName]);
        for (const cckId of group.judges) judgeRows.push([roundIdx, cckId, group.groupName]);
      }

      const playerAssigned = groupState.reduce((sum, item) => sum + item.players.length, 0);
      const playerRequested = groupState.reduce((sum, item) => sum + item.playerLimit, 0);
      const scramblerAssigned = groupState.reduce((sum, item) => sum + item.scramblers.length, 0);
      const scramblerRequested = groupState.reduce((sum, item) => sum + item.scramblerLimit, 0);
      const runnerAssigned = groupState.reduce((sum, item) => sum + item.runners.length, 0);
      const runnerRequested = groupState.reduce((sum, item) => sum + item.runnerLimit, 0);
      const judgeAssigned = groupState.reduce((sum, item) => sum + item.judges.length, 0);
      const judgeRequested = groupState.reduce((sum, item) => sum + item.judgeLimit, 0);
      const staffRequestedTotal = scramblerRequested + runnerRequested + judgeRequested;
      const reasons = [];
      const staffAssignedTotal = scramblerAssigned + runnerAssigned + judgeAssigned;

      if (
        staffAssignedTotal < staffRequestedTotal &&
        groupState.length === 1 &&
        participants.length > 0 &&
        playerAssigned >= participants.length
      ) {
        reasons.push('조가 1개이고 출전 정원이 참가자 수와 같아 스탭 배정이 불가능합니다. 조를 분할하세요.');
      }

      if (playerAssigned < playerRequested) {
        reasons.push(`출전 인원 부족 (${playerAssigned}/${playerRequested})`);
      }
      if (scramblerAssigned < scramblerRequested) {
        if (scramblerCandidateSet.size === 0) {
          reasons.push('스크램블러 후보 미선택');
        } else if (scramblerCandidatePool.length === 0) {
          reasons.push('스크램블러 가능 인원 없음');
        } else {
          reasons.push(`스크램블러 인원 부족 (${scramblerAssigned}/${scramblerRequested})`);
        }
      }
      if (runnerAssigned < runnerRequested) {
        if (runnerJudgeCandidateStrict.length === 0 && !adminFallbackUsed) {
          reasons.push('러너 가능 인원 없음');
        } else {
          reasons.push(`러너 인원 부족 (${runnerAssigned}/${runnerRequested})`);
        }
      }
      if (judgeAssigned < judgeRequested) {
        if (runnerJudgeCandidateStrict.length === 0 && !adminFallbackUsed) {
          reasons.push('심판 가능 인원 없음');
        } else {
          reasons.push(`심판 인원 부족 (${judgeAssigned}/${judgeRequested})`);
        }
      }
      if (staffAssignedTotal < staffRequestedTotal && reasons.length === 0) {
        reasons.push('스탭 정원 미충족');
      }

      roundSummaries.push({
        roundIdx,
        eventName: round.cubeEventName,
        roundName: round.roundName,
        groupCount: groupState.length,
        participantCount: participants.length,
        playerAssigned,
        playerRequested,
        scramblerAssigned,
        scramblerRequested,
        runnerAssigned,
        runnerRequested,
        judgeAssigned,
        judgeRequested,
        adminFallbackUsed,
        reason: reasons.length > 0 ? reasons.join(' · ') : undefined,
      });
    }

    const dedupeRoleRowsByRoundAndCck = (rows) => {
      const seen = new Set();
      const unique = [];
      for (const row of rows) {
        const roundIdx = Number(row?.[0]);
        const cckId = String(row?.[1] || '').trim().toLowerCase();
        const key = `${roundIdx}|${cckId}`;
        if (!Number.isFinite(roundIdx) || !cckId || seen.has(key)) continue;
        seen.add(key);
        unique.push([roundIdx, cckId, String(row?.[2] || '').trim()]);
      }
      return unique;
    };
    const safePlayerRows = dedupeRoleRowsByRoundAndCck(playerRows);
    const safeScramblerRows = dedupeRoleRowsByRoundAndCck(scramblerRows);
    const safeRunnerRows = dedupeRoleRowsByRoundAndCck(runnerRows);
    const safeJudgeRows = dedupeRoleRowsByRoundAndCck(judgeRows);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const roundIdxs = rounds.map((item) => Number(item.idx)).filter(Number.isFinite);
      await deleteAssignmentsByRoundIdxs(conn, roundIdxs, { includeRoundGroup: false });

      if (safePlayerRows.length > 0) {
        await conn.query('INSERT INTO group_competition (round_idx, cck_id, `group`) VALUES ?', [safePlayerRows]);
      }
      if (safeScramblerRows.length > 0) {
        await conn.query('INSERT INTO group_scrambler (round_idx, cck_id, `group`) VALUES ?', [safeScramblerRows]);
      }
      if (safeRunnerRows.length > 0) {
        await conn.query('INSERT INTO group_runner (round_idx, cck_id, `group`) VALUES ?', [safeRunnerRows]);
      }
      if (safeJudgeRows.length > 0) {
        await conn.query('INSERT INTO group_judge (round_idx, cck_id, `group`) VALUES ?', [safeJudgeRows]);
      }

      await conn.commit();
      const staffDeficitRounds = roundSummaries.filter((round) => {
        const scramblerRequested = Number(round.scramblerRequested || 0);
        const runnerRequested = Number(round.runnerRequested || 0);
        const judgeRequested = Number(round.judgeRequested || 0);
        const scramblerAssigned = Number(round.scramblerAssigned || 0);
        const runnerAssigned = Number(round.runnerAssigned || 0);
        const judgeAssigned = Number(round.judgeAssigned || 0);
        return (
          scramblerAssigned < scramblerRequested ||
          runnerAssigned < runnerRequested ||
          judgeAssigned < judgeRequested
        );
      });

      return res.json({
        data: {
          compIdx,
          competitionName,
          requestInfo: {
            scramblerCandidateCount: scramblerCandidateSet.size,
            excludedRunnerJudgeCount: excludedAutoAssignSet.size,
          },
          rounds: roundSummaries,
          inserted: {
            competition: safePlayerRows.length,
            scrambler: safeScramblerRows.length,
            runner: safeRunnerRows.length,
            judge: safeJudgeRows.length,
          },
          needsManualAssignment: staffDeficitRounds.length > 0,
          manualAssignmentRoundCount: staffDeficitRounds.length,
          manualAssignmentRounds: staffDeficitRounds.map((round) => ({
            roundIdx: round.roundIdx,
            eventName: round.eventName,
            roundName: round.roundName,
            reason: round.reason || '스탭 정원 미충족',
          })),
          autoAssigned: true,
        },
      });
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
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
  router.post('/api/admin/competition/:compIdx/auto-assign', handleAutoAssign);
  router.post('/api/admin/competitions/:compIdx/auto-assign', handleAutoAssign);
  router.post('/api/v1/admin/competition/:compIdx/auto-assign', handleAutoAssign);
  router.post('/api/admin/competition/:compIdx/reset-assignments', handleResetCompetitionAssignments);
  router.post('/api/admin/competitions/:compIdx/reset-assignments', handleResetCompetitionAssignments);
  router.post('/api/v1/admin/competition/:compIdx/reset-assignments', handleResetCompetitionAssignments);

  return router;
};

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ENV_DIR, '.env') });
dotenv.config({ path: path.join(ENV_DIR, '.env.local'), override: true });

const PORT = Number(process.env.PORT || 8080);
const RANKING_API_URL = (process.env.RANKING_API_URL || 'https://ranking.cubingclub.com/api/v1').replace(/\/$/, '');
const PAYMENT_API_URL = (process.env.PAYMENT_API_URL || 'https://payment.cubingclub.com/api/v1').replace(/\/$/, '');
const LOGIN_URL = process.env.LOGIN_URL || 'http://localhost:8081/login';

const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'cck_groups';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

let pool;
let dbBootstrapErrorMessage = null;

const getDbPoolOrRespond = (res) => {
  if (pool) return pool;
  res.status(503).json({
    message: 'Database unavailable',
    detail: dbBootstrapErrorMessage,
  });
  return null;
};

const parseMaybeJson = (value) => {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const proxyJson = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }
  return { ok: response.ok, status: response.status, data };
};

const proxyAuthJson = async (req, url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
      ...(init.headers || {}),
    },
  });

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  const setCookieHeaders =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : [];

  return {
    status: response.status,
    data,
    setCookieHeaders: setCookieHeaders.filter(Boolean),
  };
};

const extractListPayload = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.content)) return payload.content;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.content)) return payload.data.content;
  return [];
};

const extractObjectPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  return payload;
};

const toCompetition = (dto) => ({
  id: dto.idx,
  name: dto.compName,
  dateStart: dto.compDateStart,
  dateEnd: dto.compDateEnd,
  location: dto.location,
});

const toRound = (dto) => ({
  id: dto.idx,
  competitionId: dto.compIdx,
  competitionName: dto.compName,
  eventName: dto.cubeEventName,
  roundName: dto.roundName,
  eventStart: dto.eventStart,
  eventEnd: dto.eventEnd,
  advance: dto.advance ?? null,
});

const toConfirmedRegistration = (dto) => ({
  id: dto.id,
  competitionId: dto.competitionId,
  competitionName: dto.competitionName,
  name: dto.name,
  enName: dto.enName,
  cckId: dto.cckId,
  selectedEvents: Array.isArray(dto.selectedEvents) ? dto.selectedEvents : [],
  totalFee: dto.totalFee ?? 0,
  paymentStatus: dto.paymentStatus ?? '',
  registrationStatus: dto.registrationStatus ?? '',
  needRfCard: Boolean(dto.needRfCard),
});

const PLAYER_GROUP_TABLES = [
  { role: 'competition', tableName: 'group_competition' },
  { role: 'judge', tableName: 'group_judge' },
  { role: 'runner', tableName: 'group_runner' },
  { role: 'scrambler', tableName: 'group_scrambler' },
];

const toPlayerRoundInfo = (roundInfo) => {
  if (!roundInfo) return null;
  const roundGroupListRaw = Array.isArray(roundInfo.roundGroupList)
    ? roundInfo.roundGroupList
    : Array.isArray(roundInfo.roundGroup)
      ? roundInfo.roundGroup
      : [];
  return {
    idx: roundInfo.idx,
    compIdx: roundInfo.compIdx,
    compName: roundInfo.compName,
    cubeEventName: roundInfo.cubeEventName,
    roundName: roundInfo.roundName,
    eventStart: roundInfo.eventStart,
    eventEnd: roundInfo.eventEnd,
    roundGroupList: roundGroupListRaw.map((group) => String(group)).filter(Boolean),
  };
};

const toPlayerGroupRow = (row, roundInfo) => ({
  idx: row.idx,
  roundIdx: row.round_idx,
  cckId: row.cck_id,
  group: row.group,
  round: toPlayerRoundInfo(roundInfo),
});

const normalizeGroupName = (groupName) => {
  const normalized = String(groupName ?? '').trim();
  return normalized || '-';
};

const toGroupAssignments = (roleData) => {
  const groups = new Map();

  for (const { role } of PLAYER_GROUP_TABLES) {
    const rows = Array.isArray(roleData[role]) ? roleData[role] : [];
    for (const row of rows) {
      const groupName = normalizeGroupName(row.group);
      let groupItem = groups.get(groupName);

      if (!groupItem) {
        groupItem = {
          group: groupName,
          competition: [],
          judge: [],
          runner: [],
          scrambler: [],
        };
        groups.set(groupName, groupItem);
      }

      groupItem[role].push(row);
    }
  }

  return [...groups.values()].sort((a, b) => a.group.localeCompare(b.group, 'ko-KR'));
};

const resolvePlayerTableName = (role) => {
  const item = PLAYER_GROUP_TABLES.find((table) => table.role === role);
  return item?.tableName || null;
};

const ensureSchema = async () => {
  const sqlPath = path.resolve(process.cwd(), 'src/db/schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean);

  const conn = await pool.getConnection();
  try {
    for (const statement of statements) {
      await conn.query(statement);
    }
  } finally {
    conn.release();
  }
};

const ensureDatabase = async () => {
  const adminPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    waitForConnections: true,
    connectionLimit: 2,
    namedPlaceholders: true,
    timezone: 'Z',
  });

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await adminPool.end();
  }
};

const createMainPool = () => {
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: 'Z',
  });
};

app.get('/api/health', async (_req, res) => {
  if (!pool) {
    return res.json({
      service: 'cck-groups-server',
      status: 'degraded',
      rankingApiUrl: RANKING_API_URL,
      paymentApiUrl: PAYMENT_API_URL,
      loginUrl: LOGIN_URL,
      mysql: {
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        database: MYSQL_DATABASE,
        status: 'unavailable',
        detail: dbBootstrapErrorMessage,
      },
    });
  }

  try {
    await pool.query('SELECT 1');
    return res.json({
      service: 'cck-groups-server',
      status: 'ok',
      rankingApiUrl: RANKING_API_URL,
      paymentApiUrl: PAYMENT_API_URL,
      loginUrl: LOGIN_URL,
      mysql: {
        host: MYSQL_HOST,
        port: MYSQL_PORT,
        database: MYSQL_DATABASE,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: 'DB connection failed', detail: String(error) });
  }
});

app.post('/api/auth/token', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) return res.status(400).json({ message: 'Missing code' });

  const result = await proxyAuthJson(req, `${RANKING_API_URL}/auth/token?code=${encodeURIComponent(code)}`, {
    method: 'POST',
  });
  if (result.setCookieHeaders.length > 0) {
    res.setHeader('Set-Cookie', result.setCookieHeaders);
  }
  return res.status(result.status).json(result.data ?? {});
});

app.post('/api/auth/refresh', async (req, res) => {
  const result = await proxyAuthJson(req, `${RANKING_API_URL}/auth/refresh`, {
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

app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  const result = await proxyAuthJson(req, `${RANKING_API_URL}/auth/logout`, {
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

app.get('/api/auth/info/:cckId', async (req, res) => {
  const cckId = String(req.params.cckId || '').trim().toLowerCase();
  if (!cckId) return res.status(400).json({ message: 'Invalid cckId' });

  const result = await proxyAuthJson(req, `${RANKING_API_URL}/auth/info/${encodeURIComponent(cckId)}`);
  return res.status(result.status).json(result.data ?? {});
});

app.get('/api/auth/info', async (req, res) => {
  const authHeader = req.headers.authorization;
  const result = await proxyAuthJson(req, `${RANKING_API_URL}/auth/info`, {
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
  return res.status(result.status).json(result.data ?? {});
});

app.get('/api/v1/competition/:compIdx/player/:cckId', async (req, res) => {
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
      const result = await proxyJson(`${RANKING_API_URL}/round/${roundIdx}`);
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

app.get('/api/v1/round/:roundIdx', async (req, res) => {
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

  const roundResult = await proxyJson(`${RANKING_API_URL}/round/${roundIdx}`);
  const roundPayload = roundResult.ok ? extractObjectPayload(roundResult.data) : null;
  const roleData = {};

  for (const { role } of PLAYER_GROUP_TABLES) {
    roleData[role] = roleRows[role].map((row) => toPlayerGroupRow(row, roundPayload));
  }

  return res.json({
    roundIdx,
    round: toPlayerRoundInfo(roundPayload),
    ...roleData,
    groups: toGroupAssignments(roleData),
  });
});

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

  const roundResult = await proxyJson(`${RANKING_API_URL}/round/${roundIdx}`);
  if (!roundResult.ok) {
    return res.status(roundResult.status).json({ message: 'Failed to validate round', upstream: roundResult.data });
  }
  const roundPayload = extractObjectPayload(roundResult.data);
  if (!roundPayload || Number(roundPayload.compIdx) !== compIdx) {
    return res.status(400).json({ message: 'roundIdx does not belong to compIdx' });
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

app.post('/api/admin/competition/:compIdx/player-assignment', handlePlayerAssignmentUpdate);
app.post('/api/admin/competitions/:compIdx/player-assignment', handlePlayerAssignmentUpdate);
app.post('/api/v1/admin/competition/:compIdx/player-assignment', handlePlayerAssignmentUpdate);

app.get('/api/competitions', async (req, res) => {
  const status = String(req.query.status || 'now');
  if (!['past', 'now', 'future'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status. Use one of: past, now, future' });
  }
  const endpoint = status === 'past' ? '/comp/past' : status === 'future' ? '/comp/future' : '/comp/now';

  const result = await proxyJson(`${RANKING_API_URL}${endpoint}`);
  if (!result.ok) {
    return res.status(result.status).json({ message: 'Failed to fetch competitions', upstream: result.data });
  }

  const raw = extractListPayload(result.data);
  return res.json({ status, data: raw.map(toCompetition), source: 'ranking-api' });
});

app.get('/api/competitions/:competitionId', async (req, res) => {
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

  const compResult = await proxyJson(`${RANKING_API_URL}/comp/${competitionId}`);
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
      dayResults.push(proxyJson(`${RANKING_API_URL}/round/${competitionId}/day-count/${dayCount}`));
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

app.get('/api/competitions/:competitionId/rounds/day/:dayCount', async (req, res) => {
  const competitionId = Number(req.params.competitionId);
  const dayCount = Number(req.params.dayCount);
  if (!Number.isFinite(competitionId) || !Number.isFinite(dayCount)) {
    return res.status(400).json({ message: 'Invalid parameters' });
  }

  const result = await proxyJson(`${RANKING_API_URL}/round/${competitionId}/day-count/${dayCount}`);
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

app.get('/api/competitions/:competitionId/registrations/confirmed', async (req, res) => {
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) {
    return res.status(400).json({ message: 'Invalid competition id' });
  }

  const result = await proxyJson(`${PAYMENT_API_URL}/registration/comp/${competitionId}/confirmed`);
  if (!result.ok) {
    return res.status(result.status).json({ message: 'Failed to fetch confirmed registrations', upstream: result.data });
  }

  const raw = extractListPayload(result.data);
  return res.json({
    data: raw.map(toConfirmedRegistration),
    source: 'payment-api',
  });
});

app.get('/api/groups/competitions/:competitionId/config', async (req, res) => {
  const db = getDbPoolOrRespond(res);
  if (!db) return;
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

  const [rows] = await db.query(
    `SELECT competition_id, groups_json, organizers_json, scrambler_pool_json, published, updated_at
     FROM group_competition_config
     WHERE competition_id = ?`,
    [competitionId],
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({
      data: {
        competitionId,
        groups: [],
        organizers: [],
        scramblerPool: [],
        published: false,
        updatedAt: null,
      },
    });
  }

  const row = rows[0];
  return res.json({
    data: {
      competitionId: row.competition_id,
      groups: parseMaybeJson(row.groups_json) || [],
      organizers: parseMaybeJson(row.organizers_json) || [],
      scramblerPool: parseMaybeJson(row.scrambler_pool_json) || [],
      published: Boolean(row.published),
      updatedAt: row.updated_at,
    },
  });
});

app.put('/api/groups/competitions/:competitionId/config', async (req, res) => {
  const db = getDbPoolOrRespond(res);
  if (!db) return;
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

  const groups = Array.isArray(req.body?.groups) ? req.body.groups : [];
  const organizers = Array.isArray(req.body?.organizers) ? req.body.organizers : [];
  const scramblerPool = Array.isArray(req.body?.scramblerPool) ? req.body.scramblerPool : [];
  const published = req.body?.published === true;

  await db.query(
    `INSERT INTO group_competition_config
      (competition_id, groups_json, organizers_json, scrambler_pool_json, published)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
      groups_json = VALUES(groups_json),
      organizers_json = VALUES(organizers_json),
      scrambler_pool_json = VALUES(scrambler_pool_json),
      published = VALUES(published)`,
    [competitionId, JSON.stringify(groups), JSON.stringify(organizers), JSON.stringify(scramblerPool), published ? 1 : 0],
  );

  return res.json({
    data: {
      competitionId,
      groups,
      organizers,
      scramblerPool,
      published,
    },
  });
});

app.get('/api/groups/competitions/:competitionId/assignments', async (req, res) => {
  const db = getDbPoolOrRespond(res);
  if (!db) return;
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

  const [rows] = await db.query(
    `SELECT id, competition_id, event_name, round_name, group_name, role_name, cck_id, created_at
     FROM group_assignment
     WHERE competition_id = ?
     ORDER BY event_name ASC, round_name ASC, group_name ASC, role_name ASC, cck_id ASC`,
    [competitionId],
  );

  const data = (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row.id,
    competitionId: row.competition_id,
    eventName: row.event_name,
    roundName: row.round_name,
    groupName: row.group_name,
    roleName: row.role_name,
    cckId: row.cck_id,
    createdAt: row.created_at,
  }));

  return res.json({ data });
});

app.post('/api/groups/competitions/:competitionId/assignments/bulk', async (req, res) => {
  const db = getDbPoolOrRespond(res);
  if (!db) return;
  const competitionId = Number(req.params.competitionId);
  if (!Number.isFinite(competitionId)) return res.status(400).json({ message: 'Invalid competition id' });

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM group_assignment WHERE competition_id = ?', [competitionId]);

    if (items.length > 0) {
      const values = items.map((item) => [
        competitionId,
        String(item.eventName || ''),
        String(item.roundName || ''),
        String(item.groupName || ''),
        String(item.roleName || ''),
        String(item.cckId || ''),
      ]);

      await conn.query(
        `INSERT INTO group_assignment
          (competition_id, event_name, round_name, group_name, role_name, cck_id)
         VALUES ?`,
        [values],
      );
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return res.json({ data: { competitionId, count: items.length } });
});

const run = async () => {
  try {
    await ensureDatabase();
    createMainPool();
    await ensureSchema();
    dbBootstrapErrorMessage = null;
  } catch (error) {
    pool = null;
    dbBootstrapErrorMessage = error?.sqlMessage || error?.message || String(error);
    console.error('[CCK_Groups_Server] DB bootstrap failed. Starting in degraded mode:', error);
  }

  app.listen(PORT, () => {
    console.log(`[CCK_Groups_Server] listening on http://localhost:${PORT}`);
    console.log(`[CCK_Groups_Server] ranking proxy target: ${RANKING_API_URL}`);
    console.log(`[CCK_Groups_Server] payment proxy target: ${PAYMENT_API_URL}`);
    console.log(
      pool
        ? `[CCK_Groups_Server] mysql target: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`
        : `[CCK_Groups_Server] mysql unavailable: ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}`,
    );
  });
};

run();

import mysql from 'mysql2/promise';

let pool = null;
let dbBootstrapErrorMessage = null;

export const getPool = () => pool;

export const getDbBootstrapErrorMessage = () => dbBootstrapErrorMessage;

export const getDbPoolOrRespond = (res) => {
  if (pool) return pool;
  res.status(503).json({
    message: 'Database unavailable',
    detail: dbBootstrapErrorMessage,
  });
  return null;
};

const ensureDatabase = async (mysqlConfig) => {
  const adminPool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    waitForConnections: true,
    connectionLimit: 2,
    namedPlaceholders: true,
    timezone: 'Z',
  });

  try {
    await adminPool.query(
      `CREATE DATABASE IF NOT EXISTS \`${mysqlConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await adminPool.end();
  }
};

const createMainPool = (mysqlConfig) => {
  pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    timezone: 'Z',
  });
};

export const bootstrapDatabase = async (mysqlConfig) => {
  try {
    await ensureDatabase(mysqlConfig);
    createMainPool(mysqlConfig);
    dbBootstrapErrorMessage = null;
    return true;
  } catch (error) {
    pool = null;
    dbBootstrapErrorMessage = error?.sqlMessage || error?.message || String(error);
    return false;
  }
};

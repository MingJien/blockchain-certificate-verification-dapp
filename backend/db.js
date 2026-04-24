// Purpose: Create and export a shared SQL Server connection pool (mssql).

const sql = require("mssql");
const dbConfig = require("./config/dbConfig");

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig).then((pool) => {
      const instance = dbConfig.options?.instanceName
        ? `${dbConfig.server}\\${dbConfig.options.instanceName}`
        : dbConfig.server;
      console.log(`Connected to SQL Server: ${instance}`);
      return pool;
    });
  }
  return poolPromise;
}

async function checkDatabaseConnection() {
  const pool = await getPool();
  await pool.request().query("SELECT 1 AS ok");
  return true;
}

module.exports = {
  sql,
  getPool,
  checkDatabaseConnection
};

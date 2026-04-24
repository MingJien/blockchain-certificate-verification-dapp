require("dotenv").config();

module.exports = {
  user: process.env.DB_USER || "sa",
  password: process.env.DB_PASSWORD || "",
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "CertificateDApp",
  port: Number(process.env.DB_PORT || 1433),
  options: {
    instanceName: "MCHIENCS",
    encrypt: false,
    trustServerCertificate: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

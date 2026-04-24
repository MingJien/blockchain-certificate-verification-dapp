const { getPool, sql } = require("../db");

async function getStudentById(studentId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("studentId", sql.Int, Number(studentId))
    .query(`
      SELECT
        u.UserID AS StudentID,
        u.UserID AS OwnerID,
        u.Name AS StudentName,
        u.Name AS OwnerName,
        u.Email,
        u.WalletAddress AS StudentWalletAddress,
        u.WalletAddress AS OwnerWalletAddress,
        u.Role
      FROM dbo.Users u
      WHERE u.UserID = @studentId
        AND u.Role IN ('STUDENT', 'HOLDER')
    `);

  return result.recordset[0] || null;
}

async function listHolderUsers() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`
      SELECT
        u.UserID,
        u.Name,
        u.Email,
        u.WalletAddress,
        u.Role
      FROM dbo.Users u
      WHERE u.Role = 'HOLDER'
      ORDER BY u.UserID ASC
    `);

  return result.recordset || [];
}

async function listHolderUsersForAdmin() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`
      SELECT
        u.UserID,
        u.Name,
        u.Email,
        u.WalletAddress,
        u.Username,
        u.Role,
        u.CreatedAt
      FROM dbo.Users u
      WHERE u.Role IN ('HOLDER', 'STUDENT')
      ORDER BY u.UserID ASC
    `);

  return result.recordset || [];
}

async function getIssuerById(issuerId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("issuerId", sql.Int, Number(issuerId))
    .query(`
      SELECT
        i.IssuerID,
        i.UserID,
        i.IsActive,
        u.Name AS IssuerName,
        u.WalletAddress AS IssuerWalletAddress,
        u.Email,
        u.Role
      FROM dbo.Issuers i
      INNER JOIN dbo.Users u ON u.UserID = i.UserID
      WHERE i.IssuerID = @issuerId
    `);

  return result.recordset[0] || null;
}

async function getNextCertificateId(contractAddress) {
  const pool = await getPool();
  const normalizedContractAddress = String(contractAddress || "").toLowerCase();
  const result = await pool
    .request()
    .input("contractAddress", sql.Char(42), normalizedContractAddress)
    .query(`
      SELECT ISNULL(MAX(CertificateID), 0) + 1 AS NextCertificateId
      FROM dbo.Certificates WITH (UPDLOCK, HOLDLOCK)
      WHERE ContractAddress = @contractAddress
    `);

  return Number(result.recordset[0]?.NextCertificateId || 1);
}

async function createCertificateRecord({
  certificateId,
  contractAddress,
  studentId,
  issuerId,
  courseName,
  issueDate,
  dataHash,
  txHash,
  metadataURI,
  status
}) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("certificateId", sql.Int, Number(certificateId))
    .input("contractAddress", sql.Char(42), String(contractAddress).toLowerCase())
    .input("studentId", sql.Int, Number(studentId))
    .input("issuerId", sql.Int, Number(issuerId))
    .input("courseName", sql.NVarChar(200), String(courseName))
    .input("issueDate", sql.DateTime2, issueDate)
    .input("dataHash", sql.Char(66), String(dataHash).toLowerCase())
    .input("txHash", sql.Char(66), txHash ? String(txHash).toLowerCase() : null)
    .input("metadataURI", sql.NVarChar(500), metadataURI || null)
    .input("status", sql.NVarChar(20), String(status || "PENDING").toUpperCase())
    .query(`
      INSERT INTO dbo.Certificates
        (CertificateID, ContractAddress, StudentID, IssuerID, CourseName, IssueDate, DataHash, BlockchainTxHash, MetadataURI, Status)
      VALUES
        (@certificateId, @contractAddress, @studentId, @issuerId, @courseName, @issueDate, @dataHash, @txHash, @metadataURI, @status)
    `);

  return result.rowsAffected[0] > 0;
}

async function getCertificateById(certificateId, contractAddress) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("certificateId", sql.Int, Number(certificateId))
    .input("contractAddress", sql.Char(42), String(contractAddress).toLowerCase())
    .query(`
      SELECT
        c.CertificateID,
        c.ContractAddress,
        c.StudentID,
        su.Name AS StudentName,
        su.WalletAddress AS StudentWalletAddress,
        c.CourseName,
        c.IssuerID,
        iu.Name AS IssuerName,
        iu.WalletAddress AS IssuerWalletAddress,
        c.IssueDate,
        c.DataHash,
        c.BlockchainTxHash,
        c.MetadataURI,
        c.Status,
        c.CreatedAt
      FROM dbo.Certificates c
      INNER JOIN dbo.Users su ON su.UserID = c.StudentID
      INNER JOIN dbo.Issuers i ON i.IssuerID = c.IssuerID
      INNER JOIN dbo.Users iu ON iu.UserID = i.UserID
      WHERE c.CertificateID = @certificateId
        AND c.ContractAddress = @contractAddress
    `);

  return result.recordset[0] || null;
}

async function getCertificateByHash(hashValue, contractAddress) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("hashValue", sql.Char(66), String(hashValue).toLowerCase())
    .input("contractAddress", sql.Char(42), String(contractAddress).toLowerCase())
    .query(`
      SELECT
        c.CertificateID,
        c.ContractAddress,
        c.StudentID,
        su.Name AS StudentName,
        su.WalletAddress AS StudentWalletAddress,
        c.CourseName,
        c.IssuerID,
        iu.Name AS IssuerName,
        iu.WalletAddress AS IssuerWalletAddress,
        c.IssueDate,
        c.DataHash,
        c.BlockchainTxHash,
        c.MetadataURI,
        c.Status,
        c.CreatedAt
      FROM dbo.Certificates c
      INNER JOIN dbo.Users su ON su.UserID = c.StudentID
      INNER JOIN dbo.Issuers i ON i.IssuerID = c.IssuerID
      INNER JOIN dbo.Users iu ON iu.UserID = i.UserID
      WHERE c.DataHash = @hashValue
        AND c.ContractAddress = @contractAddress
    `);

  return result.recordset[0] || null;
}

async function updateCertificateStatus({ certificateId, contractAddress, status, txHash }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("certificateId", sql.Int, Number(certificateId))
    .input("contractAddress", sql.Char(42), String(contractAddress).toLowerCase())
    .input("status", sql.NVarChar(20), String(status).toUpperCase())
    .input("txHash", sql.Char(66), txHash ? String(txHash).toLowerCase() : null)
    .query(`
      UPDATE dbo.Certificates
      SET BlockchainTxHash = COALESCE(@txHash, BlockchainTxHash),
          Status = @status
      WHERE CertificateID = @certificateId
        AND ContractAddress = @contractAddress;

      SELECT @@ROWCOUNT AS UpdatedRows;
    `);

  const updatedRows = result.recordset[0] ? Number(result.recordset[0].UpdatedRows) : 0;
  if (updatedRows === 0) {
    return null;
  }

  return getCertificateById(certificateId, contractAddress);
}

async function insertCertificateLog({ certificateId, contractAddress, action, txHash }) {
  const pool = await getPool();
  await pool
    .request()
    .input("certificateId", sql.Int, Number(certificateId))
    .input("contractAddress", sql.Char(42), String(contractAddress).toLowerCase())
    .input("action", sql.NVarChar(50), String(action || "ISSUE").toUpperCase())
    .input("txHash", sql.Char(66), txHash ? String(txHash).toLowerCase() : null)
    .query(`
      INSERT INTO dbo.CertificateLogs (CertificateID, ContractAddress, Action, TxHash)
      VALUES (@certificateId, @contractAddress, @action, @txHash)
    `);
}

async function userExistsByWallet(walletAddress) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("walletAddress", sql.Char(42), String(walletAddress).toLowerCase())
    .query(`
      SELECT TOP 1 UserID, Role
      FROM dbo.Users
      WHERE WalletAddress = @walletAddress
    `);

  return result.recordset[0] || null;
}

async function getCertificateStats(contractAddress) {
  const pool = await getPool();
  const normalizedContractAddress = String(contractAddress || "").toLowerCase();
  const result = await pool
    .request()
    .input("contractAddress", sql.Char(42), normalizedContractAddress)
    .query(`
      SELECT
        COUNT(*) AS TotalCount,
        SUM(CASE WHEN Status = 'ACTIVE' THEN 1 ELSE 0 END) AS ActiveCount,
        SUM(CASE WHEN Status = 'REVOKED' THEN 1 ELSE 0 END) AS RevokedCount
      FROM dbo.Certificates
      WHERE ContractAddress = @contractAddress
    `);

  const row = result.recordset[0] || {};
  return {
    total: Number(row.TotalCount || 0),
    active: Number(row.ActiveCount || 0),
    revoked: Number(row.RevokedCount || 0)
  };
}

async function listCertificateIdOptions(contractAddress) {
  const pool = await getPool();
  const normalizedContractAddress = String(contractAddress || "").toLowerCase();
  const result = await pool
    .request()
    .input("contractAddress", sql.Char(42), normalizedContractAddress)
    .query(`
      SELECT c.CertificateID, c.Status
      FROM dbo.Certificates c
      WHERE c.ContractAddress = @contractAddress
      ORDER BY c.CertificateID DESC
    `);

  return result.recordset || [];
}

async function getUserByUsername(username) {
  const pool = await getPool();
  const value = String(username || "").trim();
  if (!value) return null;

  const result = await pool
    .request()
    .input("username", sql.NVarChar(50), value)
    .query(`
      SELECT TOP 1
        UserID,
        Username,
        PasswordHash,
        Role,
        WalletAddress,
        Name,
        Email
      FROM dbo.Users
      WHERE Username = @username
    `);

  return result.recordset[0] || null;
}

async function getUserById(userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("userId", sql.Int, Number(userId))
    .query(`
      SELECT TOP 1
        UserID,
        Username,
        Role,
        WalletAddress,
        Name,
        Email
      FROM dbo.Users
      WHERE UserID = @userId
    `);

  return result.recordset[0] || null;
}

async function getHolderUserById(userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("userId", sql.Int, Number(userId))
    .query(`
      SELECT TOP 1
        u.UserID,
        u.Name,
        u.Email,
        u.WalletAddress,
        u.Username,
        u.Role,
        u.CreatedAt
      FROM dbo.Users u
      WHERE u.UserID = @userId
        AND u.Role IN ('HOLDER', 'STUDENT')
    `);

  return result.recordset[0] || null;
}

async function createOrActivateHolderUser({ walletAddress, name, email, username, passwordHash }) {
  const pool = await getPool();
  const normalizedWallet = String(walletAddress || "").trim().toLowerCase();
  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim() || null;
  const safeUsername = String(username || "").trim();
  const safePasswordHash = String(passwordHash || "").trim();

  const existingByWallet = await pool
    .request()
    .input("walletAddress", sql.Char(42), normalizedWallet)
    .query(`
      SELECT TOP 1 UserID, Role
      FROM dbo.Users
      WHERE WalletAddress = @walletAddress
    `);

  const existing = existingByWallet.recordset[0] || null;
  let userId = Number(existing?.UserID || 0);
  const existingRole = String(existing?.Role || "").toUpperCase();

  if (existingRole === "ADMIN" || existingRole === "ISSUER") {
    const roleError = new Error("OWNER_ROLE_CONFLICT");
    roleError.code = "OWNER_ROLE_CONFLICT";
    throw roleError;
  }

  if (!userId) {
    const inserted = await pool
      .request()
      .input("walletAddress", sql.Char(42), normalizedWallet)
      .input("role", sql.NVarChar(20), "HOLDER")
      .input("name", sql.NVarChar(200), safeName)
      .input("email", sql.NVarChar(100), safeEmail)
      .input("username", sql.NVarChar(50), safeUsername)
      .input("passwordHash", sql.NVarChar(255), safePasswordHash)
      .query(`
        INSERT INTO dbo.Users (WalletAddress, Role, Name, Email, Username, PasswordHash)
        OUTPUT INSERTED.UserID
        VALUES (@walletAddress, @role, @name, @email, @username, @passwordHash)
      `);

    userId = Number(inserted.recordset[0]?.UserID || 0);
  } else {
    await pool
      .request()
      .input("userId", sql.Int, userId)
      .input("role", sql.NVarChar(20), "HOLDER")
      .input("name", sql.NVarChar(200), safeName || null)
      .input("email", sql.NVarChar(100), safeEmail)
      .input("username", sql.NVarChar(50), safeUsername || null)
      .input("passwordHash", sql.NVarChar(255), safePasswordHash || null)
      .query(`
        UPDATE dbo.Users
        SET
          Role = @role,
          Name = COALESCE(@name, Name),
          Email = COALESCE(@email, Email),
          Username = COALESCE(@username, Username),
          PasswordHash = COALESCE(@passwordHash, PasswordHash)
        WHERE UserID = @userId
      `);
  }

  return getHolderUserById(userId);
}

async function deactivateHolderByUserId(userId) {
  const pool = await getPool();
  const existing = await getHolderUserById(userId);
  if (!existing || String(existing.Role || "").toUpperCase() !== "HOLDER") {
    return existing;
  }

  await pool
    .request()
    .input("userId", sql.Int, Number(userId))
    .input("role", sql.NVarChar(20), "STUDENT")
    .query(`
      UPDATE dbo.Users
      SET Role = @role
      WHERE UserID = @userId
    `);

  return getHolderUserById(userId);
}

async function listIssuersWithUsers() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(`
      SELECT
        i.IssuerID,
        i.IsActive,
        i.CreatedAt,
        u.UserID,
        u.Username,
        u.Name,
        u.Email,
        u.WalletAddress,
        u.Role
      FROM dbo.Issuers i
      INNER JOIN dbo.Users u ON u.UserID = i.UserID
      ORDER BY i.IssuerID ASC
    `);

  return result.recordset || [];
}

async function listActiveIssuers() {
  const records = await listIssuersWithUsers();
  return records.filter((item) => Number(item.IsActive) === 1);
}

async function getIssuerByWallet(walletAddress) {
  const pool = await getPool();
  const normalized = String(walletAddress || "").trim().toLowerCase();
  const result = await pool
    .request()
    .input("walletAddress", sql.Char(42), normalized)
    .query(`
      SELECT TOP 1
        i.IssuerID,
        i.UserID,
        i.IsActive,
        u.Username,
        u.Name,
        u.Email,
        u.WalletAddress,
        u.Role
      FROM dbo.Issuers i
      INNER JOIN dbo.Users u ON u.UserID = i.UserID
      WHERE u.WalletAddress = @walletAddress
    `);

  return result.recordset[0] || null;
}

async function createOrActivateIssuerUser({ walletAddress, name, email, username, passwordHash }) {
  const pool = await getPool();
  const normalizedWallet = String(walletAddress || "").trim().toLowerCase();
  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim() || null;
  const safeUsername = String(username || "").trim();
  const safePasswordHash = String(passwordHash || "").trim();

  const existingByWallet = await pool
    .request()
    .input("walletAddress", sql.Char(42), normalizedWallet)
    .query(`
      SELECT TOP 1 UserID
      FROM dbo.Users
      WHERE WalletAddress = @walletAddress
    `);

  let userId = Number(existingByWallet.recordset[0]?.UserID || 0);

  if (!userId) {
    const inserted = await pool
      .request()
      .input("walletAddress", sql.Char(42), normalizedWallet)
      .input("role", sql.NVarChar(20), "ISSUER")
      .input("name", sql.NVarChar(200), safeName)
      .input("email", sql.NVarChar(100), safeEmail)
      .input("username", sql.NVarChar(50), safeUsername)
      .input("passwordHash", sql.NVarChar(255), safePasswordHash)
      .query(`
        INSERT INTO dbo.Users (WalletAddress, Role, Name, Email, Username, PasswordHash)
        OUTPUT INSERTED.UserID
        VALUES (@walletAddress, @role, @name, @email, @username, @passwordHash)
      `);

    userId = Number(inserted.recordset[0]?.UserID || 0);
  } else {
    await pool
      .request()
      .input("userId", sql.Int, userId)
      .input("role", sql.NVarChar(20), "ISSUER")
      .input("name", sql.NVarChar(200), safeName || null)
      .input("email", sql.NVarChar(100), safeEmail)
      .input("username", sql.NVarChar(50), safeUsername || null)
      .input("passwordHash", sql.NVarChar(255), safePasswordHash || null)
      .query(`
        UPDATE dbo.Users
        SET
          Role = @role,
          Name = COALESCE(@name, Name),
          Email = COALESCE(@email, Email),
          Username = COALESCE(@username, Username),
          PasswordHash = COALESCE(@passwordHash, PasswordHash)
        WHERE UserID = @userId
      `);
  }

  const existingIssuer = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query(`
      SELECT TOP 1 IssuerID
      FROM dbo.Issuers
      WHERE UserID = @userId
    `);

  if (!existingIssuer.recordset[0]) {
    await pool
      .request()
      .input("userId", sql.Int, userId)
      .query(`
        INSERT INTO dbo.Issuers (UserID, IsActive)
        VALUES (@userId, 1)
      `);
  } else {
    await pool
      .request()
      .input("userId", sql.Int, userId)
      .query(`
        UPDATE dbo.Issuers
        SET IsActive = 1
        WHERE UserID = @userId
      `);
  }

  const issuer = await getIssuerByWallet(normalizedWallet);
  return issuer;
}

async function deactivateIssuerByWallet(walletAddress) {
  const pool = await getPool();
  const normalizedWallet = String(walletAddress || "").trim().toLowerCase();
  const issuer = await getIssuerByWallet(normalizedWallet);
  if (!issuer) return null;

  await pool
    .request()
    .input("issuerId", sql.Int, Number(issuer.IssuerID))
    .query(`
      UPDATE dbo.Issuers
      SET IsActive = 0
      WHERE IssuerID = @issuerId
    `);

  return getIssuerByWallet(normalizedWallet);
}

module.exports = {
  getStudentById,
  listHolderUsers,
  getIssuerById,
  getNextCertificateId,
  createCertificateRecord,
  getCertificateById,
  getCertificateByHash,
  updateCertificateStatus,
  insertCertificateLog,
  userExistsByWallet,
  getCertificateStats,
  listCertificateIdOptions,
  getUserByUsername,
  getUserById,
  listHolderUsersForAdmin,
  getHolderUserById,
  createOrActivateHolderUser,
  deactivateHolderByUserId,
  listIssuersWithUsers,
  listActiveIssuers,
  getIssuerByWallet,
  createOrActivateIssuerUser,
  deactivateIssuerByWallet
};

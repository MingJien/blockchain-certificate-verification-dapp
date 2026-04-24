const crypto = require("crypto");

function normalizeDate(issueDate) {
  if (!issueDate) {
    return "";
  }

  if (typeof issueDate === "string") {
    return issueDate.slice(0, 10);
  }

  return new Date(issueDate).toISOString().slice(0, 10);
}

function generateCertificateHash(data) {
  const normalized = [
    String(data.certificateId || "").trim(),
    String(data.studentId || "").trim(),
    String(data.courseName || "").trim(),
    normalizeDate(data.issueDate),
    String(data.issuerWalletAddress || "").trim().toLowerCase()
  ].join("|");

  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  return `0x${digest}`;
}

// Backward-compatible alias for existing imports.
const normalizeIssueDate = normalizeDate;

module.exports = {
  generateCertificateHash,
  normalizeDate,
  normalizeIssueDate
};

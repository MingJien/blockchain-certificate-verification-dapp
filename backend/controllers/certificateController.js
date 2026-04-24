const certificateModel = require("../models/certificateModel");
const { generateCertificateHash, normalizeIssueDate } = require("../services/hashService");
const {
  isValidHash,
  isValidMetadataURI,
  normalizeAddress,
  getContractAddress,
  getAdminAddressOnChain,
  isIssuerOnChain,
  findNextAvailableCertificateId,
  issueCertificateOnChain,
  revokeCertificateOnChain,
  verifyCertificateOnChain,
  getCertificateOnChain
} = require("../services/blockchainService");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function normalizeHash(hashValue) {
  const raw = String(hashValue || "").trim().toLowerCase();
  if (raw.startsWith("0x")) {
    return raw;
  }
  return `0x${raw}`;
}

function normalizeContractAddress(address) {
  return normalizeAddress(address || getContractAddress());
}

function getChainErrorSelector(error) {
  return String(error?.data || error?.info?.error?.data || error?.error?.data || "").toLowerCase();
}

function mapBlockchainWriteError(error, action) {
  const selector = getChainErrorSelector(error);

  if (selector.includes("0xc5723b51")) {
    return {
      statusCode: 409,
      message: `Không thể ${action}: chứng chỉ chưa tồn tại trên blockchain.`
    };
  }

  if (selector.includes("0x905e7107")) {
    return {
      statusCode: 409,
      message: `Không thể ${action}: chứng chỉ đã bị thu hồi trước đó.`
    };
  }

  if (selector.includes("0x54ec5063") || selector.includes("0x7bfa4b9f")) {
    return {
      statusCode: 403,
      message: `Không thể ${action}: ví hiện tại không có quyền trên smart contract.`
    };
  }

  return {
    statusCode: 502,
    message: `Không thể ${action} trên blockchain. Vui lòng thử lại sau.`
  };
}

function getRequesterWallet(req) {
  const authWallet = req.authUser?.walletAddress;
  if (authWallet) {
    return authWallet;
  }

  const headerWallet = req.headers["x-wallet-address"];
  return req.body.requesterWallet || headerWallet || null;
}

function isStrictOnChainRequesterCheckEnabled() {
  // Security-first default: only on-chain admin/issuer can issue or revoke.
  // Set STRICT_ONCHAIN_REQUESTER_CHECK=false for demo-only relaxed mode.
  return String(process.env.STRICT_ONCHAIN_REQUESTER_CHECK || "true").trim().toLowerCase() === "true";
}

async function safeInsertVerifyLog({ certificateId, contractAddress }) {
  try {
    await certificateModel.insertCertificateLog({
      certificateId,
      contractAddress,
      action: "VERIFY",
      txHash: null
    });
  } catch (logError) {
    console.warn("insert VERIFY log skipped:", logError.message);
  }
}

function mapCertificateRecord(certificate) {
  const hashValue = normalizeHash(certificate.DataHash);
  const metadataURI = certificate.MetadataURI || "";
  const verificationURL = `http://localhost:5173/verify/${hashValue}`;

  return {
    id: certificate.CertificateID,
    certificateId: certificate.CertificateID,
    contractAddress: certificate.ContractAddress,
    holderId: certificate.StudentID,
    holderName: certificate.StudentName,
    holderWallet: certificate.StudentWalletAddress,
    studentId: certificate.StudentID,
    studentName: certificate.StudentName,
    studentWallet: certificate.StudentWalletAddress,
    issuerId: certificate.IssuerID,
    issuerName: certificate.IssuerName,
    issuerWallet: certificate.IssuerWalletAddress,
    courseName: certificate.CourseName,
    issueDate: certificate.IssueDate,
    dataHash: hashValue,
    blockchainTxHash: certificate.BlockchainTxHash,
    metadataURI,
    status: certificate.Status,
    verificationURL,
    contractPayload: {
      id: certificate.CertificateID,
      contractAddress: certificate.ContractAddress,
      studentAddress: certificate.StudentWalletAddress,
      dataHash: hashValue,
      metadataURI
    }
  };
}

async function assertIssuerPermission(req, issuerRecord) {
  if (!issuerRecord || !issuerRecord.IsActive) {
    throw new Error("ISSUER_INACTIVE");
  }

  const requesterWalletRaw = getRequesterWallet(req);
  if (!requesterWalletRaw) {
    throw new Error("REQUESTER_WALLET_REQUIRED");
  }

  const requesterWallet = normalizeAddress(requesterWalletRaw);
  const issuerWallet = normalizeAddress(issuerRecord.IssuerWalletAddress);

  const requesterUser = await certificateModel.userExistsByWallet(requesterWallet);
  if (!requesterUser) {
    throw new Error("REQUESTER_NOT_FOUND");
  }

  const role = String(requesterUser.Role || "").toUpperCase();
  const hasRole = role === "ADMIN" || role === "ISSUER";

  const requesterWalletLower = requesterWallet.toLowerCase();
  const issuerWalletLower = issuerWallet.toLowerCase();

  if (!hasRole) {
    throw new Error("UNAUTHORIZED_ISSUER");
  }

  // Default mode: trust app role + DB issuer mapping to support seeded/sample users.
  if (!isStrictOnChainRequesterCheckEnabled()) {
    if (role === "ADMIN") {
      return requesterWallet;
    }

    if (requesterWalletLower !== issuerWalletLower) {
      throw new Error("REQUESTER_ISSUER_MISMATCH");
    }

    return requesterWallet;
  }

  const adminWallet = await getAdminAddressOnChain();
  const requesterIsIssuerOnChain = await isIssuerOnChain(requesterWallet);
  const isAdminOnChain = requesterWalletLower === adminWallet.toLowerCase();
  const isHolderIssuer = requesterWalletLower === issuerWalletLower;

  if (!requesterIsIssuerOnChain) {
    throw new Error("REQUESTER_NOT_ONCHAIN_ISSUER");
  }

  if (!isAdminOnChain && !isHolderIssuer) {
    throw new Error("REQUESTER_ISSUER_MISMATCH");
  }

  return requesterWallet;
}

async function createCertificate(req, res) {
  try {
    const { holderId, studentId, courseName, issuerId, issueDate, metadataURI, contractAddress } = req.body;
    const normalizedHolderId = holderId || studentId;

    if (!normalizedHolderId || !courseName || !issuerId || !issueDate) {
      return sendError(
        res,
        400,
        "Thiếu dữ liệu bắt buộc: holderId, courseName, issuerId, issueDate."
      );
    }

    const normalizedContractAddress = normalizeContractAddress(contractAddress);
    const defaultContractAddress = getContractAddress();

    if (normalizedContractAddress !== defaultContractAddress) {
      return sendError(res, 400, "ContractAddress không khớp với backend configuration.");
    }

    const safeMetadataURI = metadataURI ? String(metadataURI).trim() : "";
    if (!isValidMetadataURI(safeMetadataURI)) {
      return sendError(res, 400, "metadataURI không hợp lệ. Chỉ cho phép https:// hoặc ipfs://.");
    }

    const student = await certificateModel.getStudentById(normalizedHolderId);
    if (!student) {
      return sendError(res, 404, "Không tìm thấy chủ sở hữu.");
    }

    const issuer = await certificateModel.getIssuerById(issuerId);
    if (!issuer) {
      return sendError(res, 404, "Không tìm thấy đơn vị cấp chứng chỉ.");
    }

    try {
      await assertIssuerPermission(req, issuer);
    } catch (permissionError) {
      if (permissionError.message === "REQUESTER_WALLET_REQUIRED") {
        return sendError(res, 400, "Thiếu requesterWallet hoặc header x-wallet-address.");
      }

      if (permissionError.message === "REQUESTER_NOT_FOUND") {
        return sendError(res, 403, "Ví requester không tồn tại trong Users.");
      }

      if (permissionError.message === "ISSUER_INACTIVE") {
        return sendError(res, 403, "Issuer đang bị vô hiệu hóa (IsActive = 0).");
      }

      if (permissionError.message === "REQUESTER_NOT_ONCHAIN_ISSUER") {
        return sendError(
          res,
          403,
          "Ví requester chưa có quyền issuer/admin trên smart contract. Hãy dùng ADMIN on-chain thêm issuer trước."
        );
      }

      if (permissionError.message === "REQUESTER_ISSUER_MISMATCH") {
        return sendError(
          res,
          403,
          "Ví requester không khớp với issuerId đang chọn. ISSUER chỉ được thao tác chứng chỉ của chính đơn vị mình."
        );
      }

      if (permissionError.message === "UNAUTHORIZED_ISSUER") {
        return sendError(res, 403, "Requester không đủ quyền issuer/admin để cấp chứng chỉ.");
      }

      throw permissionError;
    }

    const normalizedDate = normalizeIssueDate(issueDate);
    const dbNextCertificateId = await certificateModel.getNextCertificateId(normalizedContractAddress);
    const nextCertificateId = await findNextAvailableCertificateId(dbNextCertificateId);

    const hashValue = generateCertificateHash({
      certificateId: nextCertificateId,
      studentId: normalizedHolderId,
      courseName,
      issueDate: normalizedDate,
      issuerWalletAddress: issuer.IssuerWalletAddress
    }).toLowerCase();

    if (!isValidHash(hashValue)) {
      return sendError(res, 400, "Hash không hợp lệ. Định dạng đúng: 0x + 64 ký tự hex.");
    }

    let chainResult;
    try {
      chainResult = await issueCertificateOnChain({
        certificateId: nextCertificateId,
        studentAddress: student.StudentWalletAddress,
        dataHash: hashValue,
        metadataURI: safeMetadataURI
      });

      if (chainResult.receiptStatus !== undefined && chainResult.receiptStatus !== 1) {
        throw new Error("Transaction failed on-chain");
      }

      console.log("[ISSUE] ID:", nextCertificateId);
      console.log("[ISSUE] HASH:", hashValue);
      console.log("[ISSUE] TX:", chainResult.txHash);
    } catch (chainError) {
      console.error("issueCertificateOnChain error:", chainError.message);
      return sendError(res, 502, `Ghi blockchain thất bại: ${chainError.message}`);
    }

    try {
      await certificateModel.createCertificateRecord({
        certificateId: nextCertificateId,
        contractAddress: normalizedContractAddress,
        studentId: normalizedHolderId,
        issuerId,
        courseName,
        issueDate: normalizedDate,
        dataHash: hashValue,
        txHash: chainResult.txHash,
        metadataURI: safeMetadataURI,
        status: "ACTIVE"
      });

      await certificateModel.insertCertificateLog({
        certificateId: nextCertificateId,
        contractAddress: normalizedContractAddress,
        action: "ISSUE",
        txHash: chainResult.txHash
      });
    } catch (dbError) {
      console.error("createCertificate DB sync error:", dbError.message);
      return sendError(
        res,
        500,
        `Blockchain đã ghi thành công (tx: ${chainResult.txHash}) nhưng DB lưu thất bại. Cần đồng bộ thủ công.`
      );
    }

    const certificate = await certificateModel.getCertificateById(nextCertificateId, normalizedContractAddress);
    const mapped = mapCertificateRecord(certificate);

    return res.status(201).json({
      success: true,
      message: "Tạo chứng chỉ thành công và đã ghi lên blockchain.",
      data: {
        ...mapped,
        dataHash: hashValue,
        blockchainTxHash: chainResult.txHash,
        contractPayload: {
          ...mapped.contractPayload,
          dataHash: hashValue,
          metadataURI: safeMetadataURI
        }
      }
    });
  } catch (err) {
    console.error("createCertificate error:", err.message);
    return sendError(res, 500, "Không thể tạo chứng chỉ mới.");
  }
}

async function updateTransaction(req, res) {
  return sendError(
    res,
    410,
    "API này đã ngừng sử dụng. Backend mới ghi blockchain trực tiếp trong POST /api/certificates."
  );
}

async function markTransactionFailed(req, res) {
  return sendError(
    res,
    410,
    "API này đã ngừng sử dụng. Trạng thái FAILED được xử lý nội bộ khi gọi blockchain lỗi."
  );
}

async function revokeCertificate(req, res) {
  try {
    const certificateId = Number(req.params.id || 0);
    if (!certificateId) {
      return sendError(res, 400, "Mã chứng chỉ không hợp lệ.");
    }

    const contractAddress = normalizeContractAddress(req.body.contractAddress);
    const certificate = await certificateModel.getCertificateById(certificateId, contractAddress);
    if (!certificate) {
      return sendError(res, 404, "Không tìm thấy chứng chỉ.");
    }

    const issuer = await certificateModel.getIssuerById(certificate.IssuerID);
    if (!issuer) {
      return sendError(res, 404, "Không tìm thấy issuer của chứng chỉ.");
    }

    try {
      await assertIssuerPermission(req, issuer);
    } catch (permissionError) {
      if (permissionError.message === "REQUESTER_WALLET_REQUIRED") {
        return sendError(res, 400, "Thiếu requesterWallet hoặc header x-wallet-address.");
      }

      if (permissionError.message === "REQUESTER_NOT_FOUND") {
        return sendError(res, 403, "Ví requester không tồn tại trong Users.");
      }

      if (permissionError.message === "ISSUER_INACTIVE") {
        return sendError(res, 403, "Issuer đang bị vô hiệu hóa (IsActive = 0).");
      }

      if (permissionError.message === "REQUESTER_NOT_ONCHAIN_ISSUER") {
        return sendError(
          res,
          403,
          "Ví requester chưa có quyền issuer/admin trên smart contract. Hãy dùng ADMIN on-chain thêm issuer trước."
        );
      }

      if (permissionError.message === "REQUESTER_ISSUER_MISMATCH") {
        return sendError(
          res,
          403,
          "Ví requester không khớp với issuerId của chứng chỉ cần thu hồi."
        );
      }

      return sendError(res, 403, "Requester không đủ quyền revoke chứng chỉ.");
    }

    let revokeResult;
    try {
      revokeResult = await revokeCertificateOnChain(certificateId);
    } catch (chainError) {
      const mappedChainError = mapBlockchainWriteError(chainError, "thu hồi chứng chỉ");
      return sendError(res, mappedChainError.statusCode, mappedChainError.message);
    }

    await certificateModel.updateCertificateStatus({
      certificateId,
      contractAddress,
      status: "REVOKED",
      txHash: revokeResult.txHash
    });

    await certificateModel.insertCertificateLog({
      certificateId,
      contractAddress,
      action: "REVOKE",
      txHash: revokeResult.txHash
    });

    const updated = await certificateModel.getCertificateById(certificateId, contractAddress);

    return res.json({
      success: true,
      message: "Thu hồi chứng chỉ thành công.",
      data: mapCertificateRecord(updated)
    });
  } catch (err) {
    console.error("revokeCertificate error:", err.message);
    return sendError(res, 500, "Không thể thu hồi chứng chỉ.");
  }
}

async function getCertificateDetail(req, res) {
  try {
    const certificateId = Number(req.params.id);
    if (!certificateId) {
      return sendError(res, 400, "Mã chứng chỉ không hợp lệ.");
    }

    const contractAddress = normalizeContractAddress(req.query.contractAddress);
    const certificate = await certificateModel.getCertificateById(certificateId, contractAddress);
    if (!certificate) {
      return sendError(res, 404, "Không tìm thấy chứng chỉ.");
    }

    const recalculatedHash = generateCertificateHash({
      certificateId: certificate.CertificateID,
      studentId: certificate.StudentID,
      courseName: certificate.CourseName,
      issueDate: certificate.IssueDate,
      issuerWalletAddress: certificate.IssuerWalletAddress
    });

    const isIntegrityValid = recalculatedHash.toLowerCase() === String(certificate.DataHash).toLowerCase();
    const mapped = mapCertificateRecord(certificate);

    let onChainValid = false;
    let onChainCertificate = null;
    try {
      onChainValid = await verifyCertificateOnChain(certificateId, mapped.dataHash);
      onChainCertificate = await getCertificateOnChain(certificateId);
    } catch (_chainReadError) {
      onChainValid = false;
      onChainCertificate = null;
    }

    return res.json({
      success: true,
      message: "Lấy thông tin chứng chỉ thành công.",
      data: {
        ...mapped,
        recalculatedHash,
        isIntegrityValid,
        onChainValid,
        onChainCertificate
      }
    });
  } catch (err) {
    console.error("getCertificateDetail error:", err.message);
    return sendError(res, 500, "Không thể lấy thông tin chứng chỉ.");
  }
}

async function verifyById(req, res) {
  try {
    const certificateId = Number(req.params.id);
    if (!certificateId) {
      return sendError(res, 400, "Mã chứng chỉ không hợp lệ.");
    }

    const contractAddress = normalizeContractAddress(req.query.contractAddress);
    const certificate = await certificateModel.getCertificateById(certificateId, contractAddress);
    if (!certificate) {
      return sendError(res, 404, "Không tìm thấy chứng chỉ.");
    }

    const issuer = await certificateModel.getIssuerById(certificate.IssuerID);
    if (!issuer) {
      return sendError(res, 404, "Không tìm thấy đơn vị cấp chứng chỉ.");
    }

    const recalculatedHash = generateCertificateHash({
      certificateId: certificate.CertificateID,
      studentId: certificate.StudentID,
      courseName: certificate.CourseName,
      issueDate: certificate.IssueDate,
      issuerWalletAddress: issuer.IssuerWalletAddress
    });

    const isIntegrityValid = recalculatedHash.toLowerCase() === String(certificate.DataHash).toLowerCase();
    const mapped = mapCertificateRecord(certificate);
    let onChainValid = false;

    try {
      onChainValid = await verifyCertificateOnChain(certificateId, mapped.dataHash);
    } catch (_chainReadError) {
      onChainValid = false;
    }
    if (!onChainValid) {
      return res.json({
        success: true,
        message: "Chứng chỉ không tồn tại trên blockchain.",
        data: {
          ...mapped,
          recalculatedHash,
          isIntegrityValid,
          onChainValid,
          isStatusActive: false,
          invalidReason: "NOT_FOUND_ON_CHAIN",
          valid: false
        }
      });
    }

    const statusValue = String(certificate.Status || "").toUpperCase();
    const isStatusActive = statusValue === "ACTIVE";
    const valid = Boolean(isIntegrityValid && onChainValid && isStatusActive);

    console.log("[VERIFY] HASH:", mapped.dataHash);
    console.log("[VERIFY] RESULT:", valid);

    let invalidReason = "";
    if (!valid) {
      if (!isStatusActive) {
        invalidReason = `Trạng thái DB là ${statusValue || "UNKNOWN"}, không phải ACTIVE.`;
      } else if (!isIntegrityValid) {
        invalidReason = "Hash trong DB không khớp dữ liệu chứng chỉ (integrity mismatch).";
      } else if (!onChainValid) {
        invalidReason = "Chưa có hoặc chưa đồng bộ chứng chỉ này trên blockchain.";
      }
    }

    await safeInsertVerifyLog({
      certificateId: certificate.CertificateID,
      contractAddress
    });

    return res.json({
      success: true,
      message: valid
        ? "Xác minh thành công. Dữ liệu chứng chỉ toàn vẹn và hợp lệ trên blockchain."
        : "Chứng chỉ chưa hợp lệ hoàn toàn. Vui lòng kiểm tra trạng thái DB và dữ liệu on-chain.",
      data: {
        ...mapped,
        recalculatedHash,
        isIntegrityValid,
        onChainValid,
        isStatusActive,
        invalidReason,
        valid
      }
    });
  } catch (err) {
    console.error("verifyById error:", err.message);
    return sendError(res, 500, "Không thể xác minh chứng chỉ theo ID.");
  }
}

async function verifyByHash(req, res) {
  try {
    const hashValue = normalizeHash(req.params.hash);
    if (!isValidHash(hashValue)) {
      return sendError(res, 400, "Hash không hợp lệ. Định dạng đúng: 0x + 64 ký tự hex.");
    }

    const contractAddress = normalizeContractAddress(req.query.contractAddress);
    const certificate = await certificateModel.getCertificateByHash(hashValue, contractAddress);

    if (!certificate) {
      return sendError(res, 404, "Không tìm thấy chứng chỉ theo mã hash.");
    }

    const issuer = await certificateModel.getIssuerById(certificate.IssuerID);
    if (!issuer) {
      return sendError(res, 404, "Không tìm thấy đơn vị cấp chứng chỉ.");
    }

    const recalculatedHash = generateCertificateHash({
      certificateId: certificate.CertificateID,
      studentId: certificate.StudentID,
      courseName: certificate.CourseName,
      issueDate: certificate.IssueDate,
      issuerWalletAddress: issuer.IssuerWalletAddress
    });

    const isIntegrityValid = recalculatedHash.toLowerCase() === String(certificate.DataHash).toLowerCase();
    const mapped = mapCertificateRecord(certificate);
    let onChainValid = false;

    try {
      onChainValid = await verifyCertificateOnChain(certificate.CertificateID, hashValue);
    } catch (_chainReadError) {
      onChainValid = false;
    }

    if (!onChainValid) {
      return res.json({
        success: true,
        message: "Chứng chỉ không tồn tại trên blockchain.",
        data: {
          ...mapped,
          recalculatedHash,
          isIntegrityValid,
          onChainValid,
          isStatusActive: false,
          invalidReason: "NOT_FOUND_ON_CHAIN",
          valid: false
        }
      });
    }

    const statusValue = String(certificate.Status || "").toUpperCase();
    const isStatusActive = statusValue === "ACTIVE";
    const valid = Boolean(isIntegrityValid && onChainValid && isStatusActive);

    console.log("[VERIFY] HASH:", mapped.dataHash);
    console.log("[VERIFY] RESULT:", valid);

    let invalidReason = "";
    if (!valid) {
      if (!isStatusActive) {
        invalidReason = `Trạng thái DB là ${statusValue || "UNKNOWN"}, không phải ACTIVE.`;
      } else if (!isIntegrityValid) {
        invalidReason = "Hash trong DB không khớp dữ liệu chứng chỉ (integrity mismatch).";
      } else if (!onChainValid) {
        invalidReason = "Chưa có hoặc chưa đồng bộ chứng chỉ này trên blockchain.";
      }
    }

    await safeInsertVerifyLog({
      certificateId: certificate.CertificateID,
      contractAddress
    });

    return res.json({
      success: true,
      message: valid
        ? "Xác minh thành công. Dữ liệu chứng chỉ toàn vẹn."
        : "Xác minh thất bại. Dữ liệu chứng chỉ không đồng bộ.",
      data: {
        ...mapped,
        recalculatedHash,
        isIntegrityValid,
        onChainValid,
        isStatusActive,
        invalidReason,
        valid
      }
    });
  } catch (err) {
    console.error("verifyByHash error:", err.message);
    return sendError(res, 500, "Không thể xác minh chứng chỉ theo hash.");
  }
}

async function getStatistics(req, res) {
  try {
    const contractAddress = normalizeContractAddress(req.query.contractAddress);
    const stats = await certificateModel.getCertificateStats(contractAddress);
    return res.json({
      success: true,
      data: {
        total: stats.total,
        active: stats.active,
        revoked: stats.revoked
      }
    });
  } catch (err) {
    console.error("getStatistics error:", err.message);
    return sendError(res, 500, "Không thể lấy thống kê chứng chỉ.");
  }
}

async function getCertificateOptions(req, res) {
  try {
    const contractAddress = normalizeContractAddress(req.query.contractAddress);
    const records = await certificateModel.listCertificateIdOptions(contractAddress);
    return res.json({
      success: true,
      data: records.map((item) => ({
        certificateId: Number(item.CertificateID),
        status: String(item.Status || "").toUpperCase()
      }))
    });
  } catch (err) {
    console.error("getCertificateOptions error:", err.message);
    return sendError(res, 500, "Không thể lấy danh sách ID chứng chỉ.");
  }
}

async function getHolders(req, res) {
  try {
    const holders = await certificateModel.listHolderUsers();
    return res.json({
      success: true,
      data: holders.map((holder) => ({
        userId: Number(holder.UserID),
        name: holder.Name,
        walletAddress: holder.WalletAddress,
        role: holder.Role
      }))
    });
  } catch (err) {
    console.error("getHolders error:", err.message);
    return sendError(res, 500, "Không thể lấy danh sách Người sở hữu.");
  }
}

async function getIssuers(req, res) {
  try {
    const issuers = await certificateModel.listActiveIssuers();
    return res.json({
      success: true,
      data: issuers.map((issuer) => ({
        issuerId: Number(issuer.IssuerID),
        userId: Number(issuer.UserID),
        name: issuer.Name,
        username: issuer.Username || null,
        walletAddress: issuer.WalletAddress,
        isActive: Boolean(issuer.IsActive)
      }))
    });
  } catch (err) {
    console.error("getIssuers error:", err.message);
    return sendError(res, 500, "Không thể lấy danh sách Issuer.");
  }
}

module.exports = {
  createCertificate,
  updateTransaction,
  markTransactionFailed,
  revokeCertificate,
  getCertificateDetail,
  verifyById,
  verifyByHash,
  getStatistics,
  getCertificateOptions,
  getHolders,
  getIssuers
};

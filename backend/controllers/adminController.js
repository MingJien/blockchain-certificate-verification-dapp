const bcrypt = require("bcryptjs");
const certificateModel = require("../models/certificateModel");
const {
  normalizeAddress,
  getAdminAddressOnChain,
  isIssuerOnChain,
  addIssuerOnChain,
  removeIssuerOnChain
} = require("../services/blockchainService");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

function mapIssuerRow(row) {
  return {
    issuerId: Number(row.IssuerID),
    userId: Number(row.UserID),
    walletAddress: String(row.WalletAddress || "").toLowerCase(),
    username: row.Username || "",
    name: row.Name,
    email: row.Email || null,
    role: String(row.Role || "").toUpperCase(),
    isActive: Boolean(row.IsActive),
    createdAt: row.CreatedAt
  };
}

function mapHolderRow(row) {
  return {
    userId: Number(row.UserID),
    walletAddress: String(row.WalletAddress || "").toLowerCase(),
    username: row.Username || "",
    name: row.Name,
    email: row.Email || null,
    role: String(row.Role || "").toUpperCase(),
    createdAt: row.CreatedAt
  };
}

async function ensureRequesterIsOnChainAdmin(req) {
  const adminWallet = await getAdminAddressOnChain();
  const requesterWallet = String(req.authUser?.walletAddress || "").toLowerCase();

  if (!requesterWallet || requesterWallet !== adminWallet) {
    throw new Error("ONLY_ONCHAIN_ADMIN");
  }

  return adminWallet;
}

async function getIssuers(req, res) {
  try {
    await ensureRequesterIsOnChainAdmin(req);
    const issuers = await certificateModel.listIssuersWithUsers();
    return res.json({
      success: true,
      data: issuers.map(mapIssuerRow)
    });
  } catch (err) {
    if (err.message === "ONLY_ONCHAIN_ADMIN") {
      return sendError(res, 403, "Chỉ admin on-chain mới được quản lý issuer.");
    }

    console.error("getIssuers error:", err.message);
    return sendError(res, 500, "Không thể lấy danh sách issuer.");
  }
}

async function addIssuer(req, res) {
  try {
    await ensureRequesterIsOnChainAdmin(req);

    const walletAddress = normalizeAddress(req.body.walletAddress);
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!walletAddress || !name || !username || !password) {
      return sendError(
        res,
        400,
        "Thiếu dữ liệu bắt buộc: walletAddress, name, username, password."
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let onChainResult;
    try {
      onChainResult = await addIssuerOnChain(walletAddress);
    } catch (chainError) {
      return sendError(res, 502, `Add issuer on-chain thất bại: ${chainError.message}`);
    }

    let issuer;
    try {
      issuer = await certificateModel.createOrActivateIssuerUser({
        walletAddress,
        name,
        email,
        username,
        passwordHash
      });
    } catch (dbError) {
      console.error("addIssuer DB sync error:", dbError.message);
      return sendError(
        res,
        500,
        `On-chain đã thêm issuer (tx: ${onChainResult.txHash}) nhưng đồng bộ DB thất bại.`
      );
    }

    return res.status(201).json({
      success: true,
      message: "Thêm issuer thành công.",
      data: {
        issuer: mapIssuerRow(issuer),
        txHash: onChainResult.txHash
      }
    });
  } catch (err) {
    if (err.message === "ONLY_ONCHAIN_ADMIN") {
      return sendError(res, 403, "Chỉ admin on-chain mới được quản lý issuer.");
    }

    if (err.code === "INVALID_ARGUMENT") {
      return sendError(res, 400, "WalletAddress không hợp lệ.");
    }

    console.error("addIssuer error:", err.message);
    return sendError(res, 500, "Không thể thêm issuer.");
  }
}

async function removeIssuer(req, res) {
  try {
    await ensureRequesterIsOnChainAdmin(req);

    const walletAddress = normalizeAddress(req.body.walletAddress || req.params.walletAddress);

    const issuerOnChain = await isIssuerOnChain(walletAddress);
    if (!issuerOnChain) {
      const issuer = await certificateModel.deactivateIssuerByWallet(walletAddress);
      return res.json({
        success: true,
        message: "Issuer đã không còn quyền on-chain, DB đã được đồng bộ.",
        data: {
          issuer: issuer ? mapIssuerRow(issuer) : null,
          txHash: null
        }
      });
    }

    let onChainResult;
    try {
      onChainResult = await removeIssuerOnChain(walletAddress);
    } catch (chainError) {
      return sendError(res, 502, `Remove issuer on-chain thất bại: ${chainError.message}`);
    }

    let issuer;
    try {
      issuer = await certificateModel.deactivateIssuerByWallet(walletAddress);
    } catch (dbError) {
      console.error("removeIssuer DB sync error:", dbError.message);
      return sendError(
        res,
        500,
        `On-chain đã gỡ issuer (tx: ${onChainResult.txHash}) nhưng đồng bộ DB thất bại.`
      );
    }

    return res.json({
      success: true,
      message: "Gỡ issuer thành công.",
      data: {
        issuer: issuer ? mapIssuerRow(issuer) : null,
        txHash: onChainResult.txHash
      }
    });
  } catch (err) {
    if (err.message === "ONLY_ONCHAIN_ADMIN") {
      return sendError(res, 403, "Chỉ admin on-chain mới được quản lý issuer.");
    }

    if (err.code === "INVALID_ARGUMENT") {
      return sendError(res, 400, "WalletAddress không hợp lệ.");
    }

    console.error("removeIssuer error:", err.message);
    return sendError(res, 500, "Không thể gỡ issuer.");
  }
}

async function getHolders(req, res) {
  try {
    const holders = await certificateModel.listHolderUsersForAdmin();
    return res.json({
      success: true,
      data: holders.map(mapHolderRow)
    });
  } catch (err) {
    console.error("getHolders(admin) error:", err.message);
    return sendError(res, 500, "Không thể lấy danh sách holder.");
  }
}

async function addHolder(req, res) {
  try {
    const walletAddress = normalizeAddress(req.body.walletAddress);
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!walletAddress || !name || !username || !password) {
      return sendError(
        res,
        400,
        "Thiếu dữ liệu bắt buộc: walletAddress, name, username, password."
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const holder = await certificateModel.createOrActivateHolderUser({
      walletAddress,
      name,
      email,
      username,
      passwordHash
    });

    return res.status(201).json({
      success: true,
      message: "Thêm holder thành công.",
      data: {
        holder: mapHolderRow(holder)
      }
    });
  } catch (err) {
    if (err.code === "INVALID_ARGUMENT") {
      return sendError(res, 400, "WalletAddress không hợp lệ.");
    }

    if (err.code === "OWNER_ROLE_CONFLICT") {
      return sendError(res, 409, "Wallet này đang là ADMIN/ISSUER, không thể đổi sang HOLDER.");
    }

    if (err.number === 2627 || err.number === 2601) {
      return sendError(res, 409, "Username hoặc wallet đã tồn tại.");
    }

    console.error("addHolder error:", err.message);
    return sendError(res, 500, "Không thể thêm holder.");
  }
}

async function removeHolder(req, res) {
  try {
    const userId = Number(req.params.userId || 0);
    if (!userId) {
      return sendError(res, 400, "UserID không hợp lệ.");
    }

    const holder = await certificateModel.deactivateHolderByUserId(userId);
    if (!holder) {
      return sendError(res, 404, "Không tìm thấy holder.");
    }

    return res.json({
      success: true,
      message: "Đã chuyển holder sang role STUDENT.",
      data: {
        holder: mapHolderRow(holder)
      }
    });
  } catch (err) {
    console.error("removeHolder error:", err.message);
    return sendError(res, 500, "Không thể gỡ holder.");
  }
}

module.exports = {
  getIssuers,
  addIssuer,
  removeIssuer,
  getHolders,
  addHolder,
  removeHolder
};

const { verifyUserToken } = require("../services/authService");

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Thiếu token đăng nhập." });
    }

    const payload = verifyUserToken(token);
    req.authUser = {
      userId: Number(payload.sub),
      role: String(payload.role || "").toUpperCase(),
      username: payload.username,
      walletAddress: String(payload.walletAddress || "").toLowerCase()
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: "Token không hợp lệ hoặc đã hết hạn." });
  }
}

function requireRoles(...roles) {
  const normalized = roles.map((role) => String(role || "").toUpperCase());

  return function checkRole(req, res, next) {
    const currentRole = String(req.authUser?.role || "").toUpperCase();
    if (!currentRole || !normalized.includes(currentRole)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền thực hiện thao tác này." });
    }
    return next();
  };
}

module.exports = {
  requireAuth,
  requireRoles
};

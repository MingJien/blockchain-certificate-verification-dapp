const bcrypt = require("bcryptjs");
const certificateModel = require("../models/certificateModel");
const { signUserToken, mapPublicUser } = require("../services/authService");

function sendError(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

async function login(req, res) {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return sendError(res, 400, "Vui lòng nhập đầy đủ tài khoản và mật khẩu.");
    }

    const user = await certificateModel.getUserByUsername(username);
    if (!user) {
      return sendError(res, 401, "Sai tài khoản hoặc mật khẩu.");
    }

    if (!user.PasswordHash) {
      return sendError(
        res,
        500,
        "Tài khoản chưa có mật khẩu trong DB. Hãy cập nhật schema và dữ liệu mẫu mới."
      );
    }

    const validPassword = await bcrypt.compare(password, user.PasswordHash);
    if (!validPassword) {
      return sendError(res, 401, "Sai tài khoản hoặc mật khẩu.");
    }

    const token = signUserToken(user);

    return res.json({
      success: true,
      message: "Đăng nhập thành công.",
      data: {
        token,
        user: mapPublicUser(user)
      }
    });
  } catch (err) {
    console.error("login error:", err.message);
    return sendError(res, 500, "Không thể đăng nhập lúc này.");
  }
}

async function me(req, res) {
  try {
    const user = await certificateModel.getUserById(req.authUser.userId);
    if (!user) {
      return sendError(res, 404, "Không tìm thấy tài khoản.");
    }

    return res.json({
      success: true,
      data: mapPublicUser(user)
    });
  } catch (err) {
    console.error("me error:", err.message);
    return sendError(res, 500, "Không thể lấy thông tin người dùng.");
  }
}

module.exports = {
  login,
  me
};

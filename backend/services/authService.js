const jwt = require("jsonwebtoken");

const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

function getJwtSecret() {
  return process.env.JWT_SECRET || "dev-secret-change-in-production";
}

function signUserToken(user) {
  return jwt.sign(
    {
      sub: Number(user.UserID),
      role: String(user.Role || "").toUpperCase(),
      username: user.Username,
      walletAddress: String(user.WalletAddress || "").toLowerCase()
    },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function mapPublicUser(user) {
  if (!user) return null;

  return {
    userId: Number(user.UserID),
    username: user.Username,
    role: String(user.Role || "").toUpperCase(),
    walletAddress: String(user.WalletAddress || "").toLowerCase(),
    name: user.Name,
    email: user.Email || null
  };
}

module.exports = {
  signUserToken,
  verifyUserToken,
  mapPublicUser
};

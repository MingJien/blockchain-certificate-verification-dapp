// Purpose: Express server entrypoint.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const certificateRoutes = require("./routes/certificateRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const { checkBlockchainConnection } = require("./services/blockchainService");
const { checkDatabaseConnection } = require("./db");

const app = express();

const port = Number(process.env.PORT || 5000);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173";
const startupCheckEnabled = String(process.env.BLOCKCHAIN_STARTUP_CHECK || "true").toLowerCase() !== "false";
const startupCheckTimeoutMs = Number(process.env.BLOCKCHAIN_STARTUP_CHECK_TIMEOUT_MS || 15000);

app.use(cors({
  origin(origin, callback) {
    const allowed = new Set([
      corsOrigin,
      "http://localhost:5173",
      "http://127.0.0.1:5173"
    ]);

    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => res.json({ status: "ok", ok: true }));
app.get("/api/health", async (_req, res) => {
  let blockchain = "disconnected";
  let database = "disconnected";

  try {
    await checkBlockchainConnection();
    blockchain = "connected";
  } catch (_err) {
    blockchain = "disconnected";
  }

  try {
    await checkDatabaseConnection();
    database = "connected";
  } catch (_err) {
    database = "disconnected";
  }

  return res.json({
    status: blockchain === "connected" && database === "connected" ? "ok" : "degraded",
    blockchain,
    database
  });
});
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", certificateRoutes);

app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err.message);
  res.status(500).json({
    error: "Internal Server Error",
    message: err.message
  });
});

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
}

async function checkBlockchain() {
  const chainInfo = await withTimeout(
    checkBlockchainConnection(),
    startupCheckTimeoutMs,
    `Blockchain startup check timed out after ${startupCheckTimeoutMs}ms`
  );

  console.log(
    `[chain] connected: chainId=${chainInfo.chainId} contract=${chainInfo.contractAddress}`
  );
  console.log(`Connected to contract. Admin: ${chainInfo.adminAddress}`);
  console.log(`Wallet address: ${chainInfo.relayerAddress}`);
}

function validateRequiredEnv() {
  const required = ["PRIVATE_KEY", "RPC_URL", "CONTRACT_ADDRESS"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length > 0) {
    console.warn(`[env] Missing required env: ${missing.join(", ")}`);
  }
  return missing;
}

(async () => {
  const missingEnv = validateRequiredEnv();

  if (startupCheckEnabled) {
    try {
      if (missingEnv.length > 0) {
        console.warn("[chain] startup check skipped due to missing env (demo-friendly mode).");
      } else {
        await checkBlockchain();
      }
    } catch (error) {
      console.error(`[chain] startup check failed: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log("[chain] startup check skipped (BLOCKCHAIN_STARTUP_CHECK=false)");
  }

  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`);
  });
})();

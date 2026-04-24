const express = require("express");
const adminController = require("../controllers/adminController");
const { requireAuth, requireRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(requireAuth, requireRoles("ADMIN"));

router.get("/issuers", adminController.getIssuers);
router.post("/issuers", adminController.addIssuer);
router.delete("/issuers/:walletAddress", adminController.removeIssuer);
router.get("/holders", adminController.getHolders);
router.post("/holders", adminController.addHolder);
router.delete("/holders/:userId", adminController.removeHolder);

module.exports = router;

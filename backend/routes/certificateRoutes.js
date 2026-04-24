const express = require("express");
const controller = require("../controllers/certificateController");
const { requireAuth, requireRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/certificates", requireAuth, requireRoles("ADMIN", "ISSUER"), controller.createCertificate);
router.post("/certificates/issue", requireAuth, requireRoles("ADMIN", "ISSUER"), controller.createCertificate);
router.post("/certificates/tx", controller.updateTransaction);
router.post("/certificates/fail", controller.markTransactionFailed);
router.put("/certificates/:id/tx", controller.updateTransaction);
router.put("/certificates/:id/fail", controller.markTransactionFailed);
router.put("/certificates/:id/revoke", requireAuth, requireRoles("ADMIN", "ISSUER"), controller.revokeCertificate);
router.get("/certificates/:id", controller.getCertificateDetail);
router.get("/stats", controller.getStatistics);
router.get("/certificate-options", requireAuth, requireRoles("ADMIN", "ISSUER", "HOLDER", "STUDENT"), controller.getCertificateOptions);
router.get("/holders", requireAuth, requireRoles("ADMIN", "ISSUER", "HOLDER", "STUDENT"), controller.getHolders);
router.get("/issuers", requireAuth, requireRoles("ADMIN", "ISSUER", "HOLDER", "STUDENT"), controller.getIssuers);
router.get("/verify/:id", controller.verifyById);
router.get("/verify/hash/:hash", controller.verifyByHash);

module.exports = router;

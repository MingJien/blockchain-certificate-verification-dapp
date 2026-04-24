// Purpose: Generate a QR code (data URL) for a verification link.

const QRCode = require("qrcode");

async function generateQrDataUrl(text) {
  // data URL can be embedded directly in <img src="..." />
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256
  });
}

module.exports = {
  generateQrDataUrl
};

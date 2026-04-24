const { ethers } = require("ethers");
// This system uses RELAYER PATTERN (backend signs transactions) for demo purposes.
// In production, MetaMask/client-side signing should be used instead.

const CERTIFICATE_ABI = [
  "function admin() view returns (address)",
  "function isIssuer(address) view returns (bool)",
  "function addIssuer(address issuer)",
  "function removeIssuer(address issuer)",
  "function issueCertificate(uint256 id, address student, bytes32 dataHash, string metadataURI)",
  "function revokeCertificate(uint256 id)",
  "function verifyCertificate(uint256 id, bytes32 expectedHash) view returns (bool)",
  "function getCertificate(uint256 id) view returns (tuple(uint256 id, address student, address issuer, bytes32 dataHash, uint256 issuedAt, bool revoked, string metadataURI))"
];

let providerInstance;
let walletInstance;
let contractInstance;

function normalizePrivateKey(privateKeyRaw) {
  const raw = String(privateKeyRaw || "").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(withPrefix)) {
    throw new Error("Invalid PRIVATE_KEY format. Expected 64 hex chars (with or without 0x prefix).");
  }
  return withPrefix;
}

function isValidHash(hashValue) {
  return /^0x[a-f0-9]{64}$/.test(String(hashValue || "").trim().toLowerCase());
}

function isValidTxHash(txHash) {
  return isValidHash(txHash);
}

function isValidMetadataURI(metadataURI) {
  if (!metadataURI) {
    return true;
  }

  const value = String(metadataURI).trim();
  return value.startsWith("https://") || value.startsWith("ipfs://");
}

function normalizeAddress(address) {
  return ethers.getAddress(String(address || "").trim()).toLowerCase();
}

function getConfig() {
  const rpcUrl = process.env.RPC_URL;
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY");
  }
  const privateKey = normalizePrivateKey(process.env.PRIVATE_KEY);
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !privateKey || !contractAddress) {
    throw new Error("Missing blockchain config. Required: RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS.");
  }

  return {
    rpcUrl,
    privateKey,
    contractAddress: normalizeAddress(contractAddress)
  };
}

function getProvider() {
  if (!providerInstance) {
    const { rpcUrl } = getConfig();
    providerInstance = new ethers.JsonRpcProvider(rpcUrl);
  }

  return providerInstance;
}

function getWallet() {
  if (!walletInstance) {
    const { privateKey } = getConfig();
    walletInstance = new ethers.Wallet(privateKey, getProvider());
  }

  return walletInstance;
}

function getContract() {
  if (!contractInstance) {
    const { contractAddress } = getConfig();
    contractInstance = new ethers.Contract(contractAddress, CERTIFICATE_ABI, getWallet());
  }

  return contractInstance;
}

function getContractAddress() {
  const { contractAddress } = getConfig();
  return contractAddress;
}

async function getRelayerWalletAddress() {
  return (await getWallet().getAddress()).toLowerCase();
}

async function isIssuerOnChain(walletAddress) {
  const contract = getContract();
  const normalizedWallet = normalizeAddress(walletAddress);
  const result = await contract.isIssuer(normalizedWallet);
  return Boolean(result);
}

async function getAdminAddressOnChain() {
  const contract = getContract();
  return normalizeAddress(await contract.admin());
}

async function addIssuerOnChain(walletAddress) {
  const normalizedWallet = normalizeAddress(walletAddress);
  if (normalizedWallet === ethers.ZeroAddress) {
    throw new Error("Invalid issuer wallet address.");
  }

  const contract = getContract();
  const tx = await contract.addIssuer(normalizedWallet);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || null,
    walletAddress: normalizedWallet
  };
}

async function removeIssuerOnChain(walletAddress) {
  const normalizedWallet = normalizeAddress(walletAddress);
  if (normalizedWallet === ethers.ZeroAddress) {
    throw new Error("Invalid issuer wallet address.");
  }

  const contract = getContract();
  const tx = await contract.removeIssuer(normalizedWallet);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || null,
    walletAddress: normalizedWallet
  };
}

async function issueCertificateOnChain({ certificateId, studentAddress, dataHash, metadataURI }) {
  const normalizedStudent = normalizeAddress(studentAddress);
  const normalizedHash = String(dataHash || "").toLowerCase();

  if (!isValidHash(normalizedHash)) {
    throw new Error("Invalid hash format. Expected 0x + 64 hex chars.");
  }

  if (!isValidMetadataURI(metadataURI)) {
    throw new Error("Invalid metadataURI. Only https:// or ipfs:// is accepted.");
  }

  const contract = getContract();
  const tx = await contract.issueCertificate(
    BigInt(certificateId),
    normalizedStudent,
    normalizedHash,
    metadataURI || ""
  );

  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receiptStatus: Number(receipt?.status || 0),
    blockNumber: receipt?.blockNumber || null
  };
}

async function revokeCertificateOnChain(certificateId) {
  const contract = getContract();
  const tx = await contract.revokeCertificate(BigInt(certificateId));
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || null
  };
}

async function verifyCertificateOnChain(certificateId, expectedHash) {
  const normalizedHash = String(expectedHash || "").toLowerCase();
  if (!isValidHash(normalizedHash)) {
    return false;
  }

  const contract = getContract();
  const valid = await contract.verifyCertificate(BigInt(certificateId), normalizedHash);
  return Boolean(valid);
}

async function getCertificateOnChain(certificateId) {
  const contract = getContract();
  const cert = await contract.getCertificate(BigInt(certificateId));

  return {
    id: Number(cert.id),
    student: normalizeAddress(cert.student),
    issuer: normalizeAddress(cert.issuer),
    dataHash: String(cert.dataHash).toLowerCase(),
    issuedAt: Number(cert.issuedAt),
    revoked: Boolean(cert.revoked),
    metadataURI: cert.metadataURI
  };
}

async function findNextAvailableCertificateId(startingCertificateId = 1) {
  const contract = getContract();
  let candidateId = Math.max(1, Number(startingCertificateId) || 1);
  const maxAttempts = 10000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1, candidateId += 1) {
    try {
      await contract.getCertificate(BigInt(candidateId));
    } catch (error) {
      const revertData = String(error?.data || error?.info?.error?.data || error?.error?.data || "").toLowerCase();
      if (revertData.includes("0xc5723b51")) {
        return candidateId;
      }

      throw error;
    }
  }

  throw new Error("Không tìm được CertificateID trống trên blockchain.");
}

async function checkBlockchainConnection() {
  const provider = getProvider();
  const network = await provider.getNetwork();
  const adminAddress = await getAdminAddressOnChain();
  const relayerAddress = await getRelayerWalletAddress();

  return {
    chainId: Number(network.chainId),
    contractAddress: getContractAddress(),
    relayerAddress,
    adminAddress
  };
}

module.exports = {
  normalizePrivateKey,
  isValidHash,
  isValidTxHash,
  isValidMetadataURI,
  normalizeAddress,
  getContractAddress,
  getRelayerWalletAddress,
  isIssuerOnChain,
  getAdminAddressOnChain,
  addIssuerOnChain,
  removeIssuerOnChain,
  issueCertificateOnChain,
  revokeCertificateOnChain,
  verifyCertificateOnChain,
  getCertificateOnChain,
  findNextAvailableCertificateId,
  checkBlockchainConnection
};

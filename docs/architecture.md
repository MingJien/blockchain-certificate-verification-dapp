# Architecture

## Overview
This DApp uses a hybrid architecture:
- **On-chain**: stores a SHA-256 hash and revoke status per certificate ID.
- **Off-chain**: SQL Server stores human-readable certificate data and audit fields.

## Components
1. **Smart contract** (`smart-contract/contracts/Certificate.sol`)
   - `issueCertificate(id, student, dataHash, metadataURI)`
   - `revokeCertificate(id)`
   - `verifyCertificate(id, expectedHash)`

2. **Backend** (Node.js + Express)
   - REST API for issuing, retrieving, revoking, and verifying certificates
   - SQL Server persistence via `mssql`
   - On-chain writes/reads via `ethers`

3. **Frontend** (React + Vite)
   - Issuer dashboard to create certificates (calls backend)
   - Student dashboard to view certificate details (calls backend)
   - Verification pages for manual ID verify and QR-based verify
   - MetaMask wallet connection for optional on-chain verification

## Data Flow
- Issue:
  1) Frontend POST `/api/certificates`
  2) Backend computes SHA-256 hash
  3) Backend writes hash on-chain (ethers)
  4) Backend persists certificate in SQL Server and returns QR

- Verify:
  1) Frontend GET `/api/verify/:id`
  2) Backend loads hash from SQL Server
  3) Backend calls on-chain `verifyCertificate(id, hash)`
  4) Backend returns `{ valid, revoked }`

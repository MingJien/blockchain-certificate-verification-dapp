🎓 Blockchain Certificate Verification DApp
📌 Overview

Hệ thống xác minh chứng chỉ sử dụng blockchain:

Lưu certificate hash on-chain
Đảm bảo không thể sửa đổi (immutability)
Hỗ trợ:
Issue (cấp chứng chỉ)
Verify (xác minh)
Revoke (thu hồi)
🏗 Architecture
Frontend (React)
      ↓
Backend (Node.js)
      ↓
Database (MySQL)

      ↘
Smart Contract (Ethereum)
🔄 Core Flow
1. Issue Certificate
Tạo certificate
Sinh hash
Ghi lên blockchain
Lưu DB + txHash
2. Verify Certificate
Nhập certificateId hoặc hash
So sánh giữa DB và blockchain
Kết quả:
VALID
INVALID / REVOKED
3. Revoke Certificate
Gọi smart contract
Update DB
Verify lại → INVALID
🎬 HOW TO DEMO
Issue certificate → copy txHash
Verify → kết quả VALID
Revoke certificate
Verify lại → INVALID
🔐 Authorization Mode
✅ Strict Mode (Khuyến nghị)
STRICT_ONCHAIN_REQUESTER_CHECK=true
Check:
Role trong DB (ADMIN / ISSUER)
Quyền ví trên blockchain
Nếu là ISSUER:
Ví phải khớp với issuerId

→ Bảo mật đúng chuẩn Web3

⚠️ Relaxed Mode (Demo fallback)
STRICT_ONCHAIN_REQUESTER_CHECK=false
Chỉ kiểm tra DB
Không bắt buộc quyền on-chain

→ Dùng khi demo nhanh / thiếu config blockchain

⚙️ Setup
Backend
cd backend
npm install
npm run dev
Frontend
cd frontend
npm install
npm start
Database

Import file:

Certificate.sql
📂 Project Structure
backend/
frontend/
smart-contract/
postman/
Certificate.sql
📎 Notes
On-chain: chỉ lưu certificate hash
Off-chain: lưu metadata
Backend đóng vai trò:
Bridge Web2 ↔ Web3
Authorization layer

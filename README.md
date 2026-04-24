Blockchain Certificate Verification DApp
Overview

Hệ thống xác minh chứng chỉ sử dụng blockchain:

Lưu certificate hash on-chain
Đảm bảo không thể sửa đổi
Hỗ trợ:
Issue
Verify
Revoke
Architecture
Frontend (React)
      ↓
Backend (Node.js)
      ↓
Database (MySQL)

      ↘
   Smart Contract (Ethereum)
Core Flow

Issue

Tạo certificate → hash → ghi on-chain → lưu DB + txHash

Verify

Nhập ID/hash → so sánh DB + blockchain

Revoke

Gọi contract → update DB → verify lại = INVALID
HOW TO DEMO
Issue certificate → copy txHash
Verify → kết quả VALID
Revoke certificate
Verify lại → INVALID
Authorization Mode
Strict (khuyến nghị)
STRICT_ONCHAIN_REQUESTER_CHECK=true
Check role DB + quyền on-chain
Issuer phải đúng ví
Relaxed (demo fallback)
STRICT_ONCHAIN_REQUESTER_CHECK=false
Chỉ check DB
Không bắt buộc quyền on-chain
Setup
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm start

Import DB:

Certificate.sql
Project Structure
backend/
frontend/
smart-contract/
postman/
Certificate.sql
Notes
On-chain: chỉ lưu hash
Off-chain: metadata
Backend: bridge Web2 ↔ Web3

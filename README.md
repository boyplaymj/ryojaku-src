# 両雀 Ryōjaku — 服務原始碼（工程師交付，Claude 接手保全）

2026-07-17 工程師交付三專案完整源碼，經清理（去 node_modules/vendor/編譯產物/機密）後保全。

- `backend/`  — Go，AWS Lambda（module `mahjongclub-backend`，一 endpoint 一 Lambda）
- `frontend/` — React+Vite+TS 玩家端 PWA
- `admin_frontend/` — React+Vite+TS 管理後台

## ⚠️ 機密
`.env` / `lambda-config.json` / `environment-config.json` / `PUSH_KEYS.md`（含 JWT_SECRET、ENCRYPTION_KEY、VAPID、Gemini/OpenAI key）
**未包含在本 repo**，隔離保全於主機 `/opt/sml/ryojaku-secrets/`（chmod 700），遷移時進 SSM。

## 對照文件
規格/遷移計畫在主 repo `tools/ryojaku-webapp/`：SOURCE_TRUTH.md（正典）、MIGRATION_PLAN.md。

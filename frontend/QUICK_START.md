# MahjongClub APP - 快速啟動指南

## 🎉 恭喜！後端 API 已完成配置

所有後端 API 已成功部署並配置完成，現在可以開始測試 APP 了！

---

## 🚀 快速啟動

### 1. 確認環境變數
檢查 `.env` 檔案是否包含正確的 API URL：

```env
VITE_API_BASE_URL=https://00pox0hvv4.execute-api.ap-southeast-1.amazonaws.com/prod
```

✅ 已配置完成，無需修改！

### 2. 安裝依賴（如果尚未安裝）
```bash
npm install
```

### 3. 啟動開發伺服器
```bash
npm run dev
```

### 4. 開啟瀏覽器
訪問: `http://localhost:5173`

---

## 🧪 測試流程

### 測試 1: 註冊新用戶
1. 在登入頁面點擊「註冊新帳號」
2. 填寫以下資訊：
   - Email: 使用真實的 Email 格式
   - 密碼: 至少 8 個字元
   - 確認密碼: 與密碼相同
   - 顯示名稱: 您的暱稱
3. 點擊「註冊」按鈕
4. 如果成功，應該會自動登入並進入主頁

### 測試 2: 登入現有用戶
1. 在登入頁面輸入 Email 和密碼
2. 點擊「登入」按鈕
3. 如果成功，應該會進入主頁

### 測試 3: LINE ID 登入（備援）
1. 在登入頁面點擊「使用 LINE ID 登入」
2. 輸入加密的 LINE ID
3. 點擊「登入」按鈕

---

## 📱 可用功能

### ✅ 已完成並可測試的功能
1. **用戶註冊** - Email/Password 註冊
2. **用戶登入** - Email/Password 或 LINE ID 登入
3. **搜尋團局** - 瀏覽和搜尋麻將團局
4. **報名團局** - 報名參加團局
5. **我的團局** - 查看已報名的團局
6. **個人資料** - 查看和編輯個人資料
7. **團局詳情** - 查看團局詳細資訊

### ⚠️ 尚未實作的功能
- **創建團局** - WEB 版本沒有此功能，APP 版本暫時跳過

---

## 🔍 API 端點

### 認證相關
- `POST /mahjongclub_app_register` - 註冊新用戶
- `POST /mahjongclub_app_login` - 用戶登入

### 團局相關（與 WEB 版本共用）
- `POST /mahjongclub_web_search_games` - 搜尋團局
- `POST /mahjongclub_web_my_games` - 我的團局
- `POST /mahjongclub_web_register` - 報名團局
- `POST /mahjongclub_web_game_detail` - 團局詳情
- `POST /mahjongclub_web_user_profile` - 用戶資料

---

## 🐛 故障排除

### 問題 1: 登入/註冊按鈕無反應
**解決方式:**
1. 開啟瀏覽器開發者工具（F12）
2. 查看 Console 是否有錯誤訊息
3. 查看 Network 標籤，確認 API 請求是否發送
4. 確認 `.env` 檔案中的 API URL 正確
5. 重新啟動開發伺服器

### 問題 2: API 回應 404 錯誤
**解決方式:**
1. 確認 API Gateway 已正確配置
2. 執行測試腳本驗證 API：
   ```bash
   cd ../LineBot
   .\TestAppAPIs.ps1
   ```

### 問題 3: 註冊時顯示「Email 已存在」
**解決方式:**
- 這是正常的！使用不同的 Email 地址註冊
- 或者使用現有的 Email 和密碼登入

### 問題 4: 密碼錯誤
**解決方式:**
- 確認密碼至少 8 個字元
- 確認密碼和確認密碼一致
- 登入時確認輸入的密碼正確

---

## 📊 測試用戶

如果需要快速測試，可以使用以下測試帳號：

```
Email: test@example.com
Password: Test1234!
User ID: APP_sXm8M_pit3pE9G7c
```

**注意**: 這是公開的測試帳號，請勿用於生產環境！

---

## 🎯 下一步

### 建議的開發流程
1. ✅ 測試註冊和登入功能
2. ✅ 測試搜尋團局功能
3. ✅ 測試報名團局功能
4. ✅ 測試個人資料功能
5. 🔄 根據需求添加更多功能
6. 🔄 優化 UI/UX
7. 🔄 添加錯誤處理和驗證
8. 🔄 準備生產環境部署

### 可選的改進
- 添加 Email 驗證功能
- 添加忘記密碼功能
- 添加社交登入（Google, Facebook）
- 添加推送通知
- 添加離線支援
- 優化效能和載入速度

---

## 📚 相關文件

- `API_GATEWAY_CONFIGURATION_SUMMARY.md` - API Gateway 配置詳情
- `../LineBot/cmd/lambdas/apis/APP_APIS_README.md` - API 使用說明
- `../LineBot/cmd/lambdas/apis/DEPLOYMENT_GUIDE.md` - 部署指南

---

## 💡 提示

1. **開發模式**: 使用 `npm run dev` 啟動開發伺服器，支援熱重載
2. **生產建置**: 使用 `npm run build` 建置生產版本
3. **預覽建置**: 使用 `npm run preview` 預覽生產建置
4. **型別檢查**: 使用 `npm run type-check` 檢查 TypeScript 型別

---

## ✅ 準備就緒！

所有配置已完成，現在可以開始測試和開發了！

如果遇到任何問題，請參考故障排除部分或查看相關文件。

**祝開發順利！** 🚀


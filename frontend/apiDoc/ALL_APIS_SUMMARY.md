# 所有 API 總覽

## Base URL
```
https://k10zeqldu6.execute-api.ap-southeast-1.amazonaws.com
```

---

## 完整 API 列表

### 1. APP 用戶註冊
- **端點**: `POST /mahjongclub_app_register`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 註冊新的 APP 用戶帳號
- **文檔**: [📄 詳細文檔](./01_app_register.md)

### 2. APP 用戶登入
- **端點**: `POST /mahjongclub_app_login`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: APP 用戶登入，支援 Email/Password 或 LINE ID
- **文檔**: [📄 詳細文檔](./02_app_login.md)

### 3. 驗證用戶
- **端點**: `POST /mahjongclub_web_verify_user`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 驗證用戶身份並獲取用戶資訊
- **文檔**: [📄 詳細文檔](./03_verify_user.md)

### 4. 創建團局
- **端點**: `POST /mahjongclub_web_create_game`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: -120
- **功能**: 創建新的麻將團局
- **文檔**: [📄 詳細文檔](./04_create_game.md)

### 5. 搜尋團局
- **端點**: `POST /mahjongclub_web_search_games`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 搜尋可用的團局，支援全部搜尋和附近搜尋
- **文檔**: [📄 詳細文檔](./05_search_games.md)

### 6. 團局詳情
- **端點**: `POST /mahjongclub_web_game_detail`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 獲取團局詳細資訊，包括已加入玩家和待審核報名
- **文檔**: [📄 詳細文檔](./06_game_detail.md)

### 7. 我的團局
- **端點**: `POST /mahjongclub_web_my_games`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 獲取用戶創建和參加的所有團局
- **文檔**: [📄 詳細文檔](./07_my_games.md)

### 8. 取消團局
- **端點**: `POST /mahjongclub_web_cancel_game`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: +120 (退還)
- **功能**: 主辦人取消團局，退還點數並通知所有用戶
- **文檔**: [📄 詳細文檔](./08_cancel_game.md)

### 9. 報名團局
- **端點**: `POST /mahjongclub_web_register`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: -20
- **功能**: 報名參加團局，需等待主辦人審核
- **文檔**: [📄 詳細文檔](./09_register_game.md)

### 10. 接受報名
- **端點**: `POST /mahjongclub_web_accept_registration`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 主辦人接受報名申請
- **文檔**: [📄 詳細文檔](./10_accept_registration.md)

### 11. 拒絕報名
- **端點**: `POST /mahjongclub_web_reject_registration`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: +20 (退還給報名者)
- **功能**: 主辦人拒絕報名申請，退還報名費
- **文檔**: [📄 詳細文檔](./11_reject_registration.md)

### 12. 用戶資料
- **端點**: `POST /mahjongclub_web_user_profile`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 獲取或更新用戶資料和偏好設定
- **文檔**: 📝 待完成

### 13. 用戶資訊
- **端點**: `GET /mahjongclub_web_user_info`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 獲取指定用戶的公開資訊
- **文檔**: 📝 待完成

### 14. 獲取評分
- **端點**: `POST /mahjongclub_web_get_ratings`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 獲取用戶的評分列表
- **文檔**: 📝 待完成

### 15. 提交評分
- **端點**: `POST /mahjongclub_web_submit_rating`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 提交對其他用戶的評分和評論
- **文檔**: 📝 待完成

### 16. 用戶評論
- **端點**: `GET /mahjongclub_web_user_comments`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 獲取指定用戶收到的評論列表
- **文檔**: 📝 待完成

### 17. 獲取通知
- **端點**: `GET /mahjongclub_web_notifications`
- **認證**: ✅ 需要 (userId)
- **點數**: 0
- **功能**: 獲取用戶的通知列表，支援分頁
- **文檔**: 📝 待完成

### 18. 訂閱推送
- **端點**: `POST /mahjongclub_web_subscribe_push`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 訂閱推送通知
- **文檔**: 📝 待完成

### 19. 取消訂閱
- **端點**: `POST /mahjongclub_web_unsubscribe_push`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 取消推送通知訂閱
- **文檔**: 📝 待完成

### 20. 訂閱狀態
- **端點**: `GET /mahjongclub_web_subscription_status`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 查詢推送通知訂閱狀態
- **文檔**: 📝 待完成

### 21. VAPID 金鑰
- **端點**: `GET /mahjongclub_web_vapid_key`
- **認證**: ❌ 不需要
- **點數**: 0
- **功能**: 獲取 VAPID 公鑰用於推送通知
- **文檔**: 📝 待完成

### 22. 分析數據
- **端點**: `POST /mahjongclub_analytics`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 獲取系統分析數據
- **文檔**: 📝 待完成

### 23. 事件命令
- **端點**: `POST /mahjongclub_event_commands`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: 0
- **功能**: 處理事件相關命令
- **文檔**: 📝 待完成

### 24. 兌換點數
- **端點**: `POST /mahjongclub-redeem`
- **認證**: ✅ 需要 (userId 或 lineID)
- **點數**: +N (依兌換碼而定)
- **功能**: 使用兌換碼增加點數
- **文檔**: 📝 待完成

---

## 統計資訊

- **總 API 數量**: 24
- **需要認證**: 17 (70.8%)
- **不需認證**: 7 (29.2%)
- **扣除點數**: 2 (創建團局 -120, 報名團局 -20)
- **增加點數**: 3 (取消團局 +120, 拒絕報名 +20, 兌換點數 +N)

---

**最後更新**: 2025-11-21


# API 路徑雙向對帳報告（2026-07-30）

純靜態對帳，**未動 AWS**。目的：把 `functions.manifest.json` 裡 66 條「推斷待驗」(`path` 帶 `?`) 的路徑，
用可查證的地面真相釘死。

## 0. 地面真相有三層，可信度由高到低

| 層級 | 來源 | 覆蓋 | 說明 |
|---|---|---|---|
| A 腳本實證 | `backend/scripts/setup_*.ps1` | 6 顆函式／13 條 route-key | 工程師實際建路由的指令，最硬 |
| B 前端實證 | `frontend/services/apiService.ts`＋`admin_frontend/src/services/api.ts` | 56 顆 | 前端是**實際打通工程師 prod 的 client**，它叫得動＝上游就長這樣 |
| C 零證據 | 只從 Go `main.go` 推斷、且無人呼叫 | 4 顆 | 純猜 |

**A 層的關鍵事實**：四支建 REST 路由的腳本全部指向同一個 API `yg7y0xkb50`，且用的是
`aws apigatewayv2 create-route --route-key "GET /ledger"` —— `route-key` 是 **HTTP API (v2) 語法**，
REST v1 沒有這東西。所以 `yg7y0xkb50` 是 HTTP API，儘管腳本註解自稱 "REST route"。
WebSocket 另一支 `ek5dythoh9`。

→ **上游只有一個 HTTP API + 一個 WebSocket API。manifest 裡 `REST_V1` / `HTTP_V2` 的分野是我方重建時自己發明的。**
前端 (`apiService.ts:10`) 與後台 (`api.ts:11`) 都只有**單一** `VITE_API_BASE_URL`，
所以只要某條被分到非 REST 的那一半，從 App／後台就打不到。

腳本實證的 13 條 route-key：
```
yg7y0xkb50: GET|POST|PUT|DELETE /ledger, GET /ledger/summary,
            POST /claim-push-bonus, GET /chat/rooms, GET /chat/history,
            GET /chat/room-info, POST /chat-mark-read
ek5dythoh9: $connect, $disconnect, sendMessage
```

## 1. 對帳範圍

| 方向 | 數量 | 結果 |
|---|---|---|
| 前端 → manifest | App 53 條呼叫 | 9 條從單一 base URL **打不到** |
| 後台 → manifest | 後台 32 條呼叫 | **全部可達** |
| manifest → 前端（死路由） | 72 顆函式 | 1 顆真死路由（`analytics`）；其餘 3 顆「無人呼叫」其實是路徑寫錯的同一批 |
| 方法別 GET/POST | 85 條呼叫 | **0 條不符**（但 manifest 大量用 `ANY`，此項證明力弱） |
| Go handler 多路徑 | 72 顆全掃 | 6 顆服務多路徑，**只有 `ledger` 在 manifest 漏填** |

前端 53 條的抽取涵蓋 `apiRequest('/…')` 字面值與 `let url = '/…'` 變數兩種寫法；
另已確認**沒有**繞過 `apiRequest` 直接 `fetch(API_BASE_URL + …)` 的呼叫點。

## 2. 九條打不到的病因（三類）

### 2a. 切法問題 —— 路徑對，但被分到 HTTP API／Lambda URL（5 條）

| 前端呼叫 | manifest 現況 | 上游真相 |
|---|---|---|
| `POST /claim-push-bonus` | `HTTP_V2` | 腳本實證在 `yg7y0xkb50` |
| `POST /daily-bonus` | `HTTP_V2` | 同一個 API |
| `GET,POST /notifications` | `HTTP_V2` | 同一個 API |
| `GET /ratings` | `HTTP_V2` | 同一個 API |
| `POST /redeem-code` | `LAMBDA_URL` | 前端走 base URL 呼叫，故上游必為 API 路由 |

`redeem-code` 這條正是 `README.md:37` 那個未結案的 TODO
（「`redeem-code`/`event-commands`/`redeem-points` 是 Lambda URL，manifest 已標；確認前端呼叫路徑」）。
另兩顆已在 P3 併入主 REST，只剩它。
※ 其 Lambda 內部已自驗 JWT（`main.go:130-141` `VerifyTokenWithUserPwGate`），
所以 `AuthType: NONE` 不構成漏洞，但位址對不上仍然打不到。

### 2b. 推斷路徑名寫錯（3 條）—— 前端才是規格

| 前端實際呼叫 | manifest 誤寫 |
|---|---|
| `POST /accept-registration` | `/registrations/accept?` |
| `POST /reject-registration` | `/registrations/reject?` |
| `POST /chat/get-upload-url` | `/chat/upload-url?` |

### 2c. 多路徑漏填（1 條）

`GET /ledger/summary` 腳本實證存在（Go `mahjongclub_ledger/main.go:239` 有處理），
但 manifest 的 `ledger` 只填了 `/ledger`。

> **訂正先前結論**：這**不是**資料模型缺陷。`gen_app_template.py:287-291` 早就支援
> `path` 以逗號列多條（`admin-vouchers`、`event-commands` 正在用）。單純是值沒填。

## 3. 「其他 61 顆是否也被截掉第二條路徑」→ 已掃完，答案是「沒有」

全掃 72 顆 Go handler，服務多路徑的共 6 顆，其中 5 顆 manifest 已正確覆蓋：

| 函式 | 實際路徑 | manifest | 判定 |
|---|---|---|---|
| `admin-moderation` | `/reports` `/action` | `/admin/moderation/{proxy+}` | ✅ |
| `admin-vouchers` | bare＋`/update` `/delete` | `/admin/vouchers,/admin/vouchers/{proxy+}` | ✅ |
| `analytics` | 8 條 `/analytics/*` | `/analytics/{proxy+}` | ✅ |
| `redeem-points` | 5 條 `/redeem-codes/*` | `/redeem-codes/{proxy+}` | ✅ |
| `event-commands` | bare＋4 條 | `/event-commands,/event-commands/{proxy+}` | ✅ |
| **`ledger`** | `/ledger` `/ledger/summary` | `/ledger` | ❌ 見 2c |

殘留的靜態不可判定項：`admin-analysis` 的 `{analysisType}` 由 `pathParts` 動態取，
但 `{proxy+}` 已涵蓋，且後台實際只用 8 種（users/games/social/chat/traffic/ledger/token/invite），全在覆蓋內。

## 4. 真死路由：`analytics`

`/analytics/{proxy+}`，`auth: public`，讀 `Games`/`Users`/`Registrations`/`APITokenStats`。
**全 repo 零呼叫者**（App、後台、任何 .ts/.tsx/.js/.html 都沒有）。
一個沒人用、又不需驗證就能撈用戶與營運數據的端點。這是本次對帳唯一的新增安全面向發現。

**→ 已於 2026-07-30 單獨收口（P0-a），不等後面八條**：`auth: public → admin`，
**刻意不刪路由**（保留可逆性，日後接後台報表可直接用）。這條不必等 §5「⚠️ 前置條件」，
因為它本來就是 `REST_V1`，不改 `apiType`、不影響 `HTTP_V2` 是否歸零。
`ryojaku-app-stg` UPDATE_COMPLETE `2026-07-30T13:36:52Z`，同日 18:48Z 實打驗收（`/tmp/verify_analytics.sh`）：

| 檢查 | 結果 |
|---|---|
| 無 token：`/analytics/{overview,users/stats,realtime}` | 401 |
| 合法 admin token：`/analytics/{overview,users/stats}` | 200＋真實資料 |
| 反控·竄改簽章的 admin token | 401 |
| 迴歸·`/admin/analysis/users`（後台真正在用的那條） | 200 |

②不可省：只驗①會被 fail-closed 的假象騙過 —— 路由整條壞掉時①也會「通過」。
③證明擋下來的是**簽章驗證**而非「有 header 就放行」。

## 5. 建議的 manifest 修訂（九條中 analytics 已套用，其餘八條尚未）

```
ledger              path: "/ledger?"                  → "/ledger,/ledger/summary"
chat-get-upload-url path: "/chat/upload-url?"         → "/chat/get-upload-url"
accept-registration apiType: HTTP_V2→REST_V1, path: "/registrations/accept?" → "/accept-registration"
reject-registration apiType: HTTP_V2→REST_V1, path: "/registrations/reject?" → "/reject-registration"
notifications       apiType: HTTP_V2 → REST_V1
get-ratings         apiType: HTTP_V2 → REST_V1
daily-bonus         apiType: HTTP_V2 → REST_V1
claim-push-bonus    apiType: HTTP_V2 → REST_V1
redeem-code         apiType: LAMBDA_URL → REST_V1,   path: "/redeem-code?" → "/redeem-code"
analytics           ✅ 已套用(2026-07-30 P0-a)：auth: public → admin，路由保留 —— 見 §4
（另：62 條已由 A/B 層實證的 path 可拿掉 `?` 標記；改完只剩 analytics 帶 `?`）
```

**方向理由**：不要把 59 條搬去 HTTP API 去模仿上游 —— 我方 REST `9mu0vajn38` 已有 62 條在跑、
自訂網域 `ryojaku-api.boyplaymj.com` 也掛在它上面，那樣是拆掉能動的東西。反過來把 7 條收進 REST 才是小動作。

### ⚠️ 套用前的前置條件

（僅適用於**剩下八條**；`analytics` 不改 `apiType`，已先行單獨出隊，見 §4。）

上述修訂會讓 `HTTP_V2` 歸零，但 `gen_app_template.py` 的 `head` 樣板是**無條件**輸出
`HttpApi: AWS::Serverless::HttpApi`（第 236 行）與 `Outputs.HttpApiUrl`（第 457 行），
還有 `__HTTP_AUTH__` 的 authorizer permission。
**一個沒有任何 route 的 HTTP API 能不能過 CFN 尚未驗證** —— 修 manifest 前要先讓
`gen_app_template.py` 在無 HTTP_V2 函式時整段略過 `HttpApi`（含 Outputs 與 authorizer permission），
否則會在 deploy 當下才炸。

順序建議：① 改 `gen_app_template.py` 讓 HttpApi 可選 → ② 一次改完 manifest 九條 →
③ `gen_app_template.py` + `sam deploy` 一次進出 stack（分兩次部署只是讓 stack 多進一次風險期）。

## 6. 本次對帳沒能證明的事

- **方法別**：manifest 大量用 `ANY`，前端 85 條呼叫 0 條不符，但這多半是 `ANY` 太寬鬆而非真的對齊。
  上游 `ledger` 是 `GET/POST/PUT/DELETE /ledger` 但只有 `GET /ledger/summary`；
  我方 `ANY` + 兩條 path 會讓 `POST /ledger/summary` 也進得了 Lambda（上游會 404）。是超集，不是破壞。
- **請求/回應 body 形狀**：完全未對帳。路徑通了不代表欄位名對得上。
- **`auth` 欄位**：72 顆的 `public`/`user`/`admin` 分類未逐顆驗證，只在 `analytics` 這顆偶然發現異常。

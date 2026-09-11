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

⚠️ **本表是 2026-07 對帳當下的紀錄，不是即時現況** —— 已解決的逐列標注，
不改寫原值（改寫的話「當初就沒問題」與「後來修好了」會分不出來）。
🔴 這一段是 Codex 覆驗抓到的：`daily-bonus` 那列與同檔 §4b **互相矛盾**，
而「manifest 現況」這個欄名讀起來就是即時的。同一個檔裡兩個說法相反時，
讀到哪一個取決於從哪裡進來 —— 從 §2a 進來的人會拿到過期那份。

| 前端呼叫 | manifest 現況 | 上游真相 |
|---|---|---|
| `POST /claim-push-bonus` | `HTTP_V2` | 腳本實證在 `yg7y0xkb50` |
| `POST /daily-bonus` | ~~`HTTP_V2`~~ → **`REST_V1`** ✅ 已解決 2026-09-10（§4b） | 同一個 API |
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
daily-bonus         ✅ 已套用(2026-09-10)：apiType HTTP_V2→REST_V1、path 去 "?" —— 見 §4b
claim-push-bonus    apiType: HTTP_V2 → REST_V1
redeem-code         apiType: LAMBDA_URL → REST_V1,   path: "/redeem-code?" → "/redeem-code"
analytics           ✅ 已套用(2026-07-30 P0-a)：auth: public → admin，路由保留 —— 見 §4
（另：62 條已由 A/B 層實證的 path 可拿掉 `?` 標記；改完只剩 analytics 帶 `?`）
```

**方向理由**：不要把 59 條搬去 HTTP API 去模仿上游 —— 我方 REST `9mu0vajn38` 已有 62 條在跑、
自訂網域 `ryojaku-api.boyplaymj.com` 也掛在它上面，那樣是拆掉能動的東西。反過來把 7 條收進 REST 才是小動作。

## 4b. `daily-bonus` 單獨出隊（2026-09-10）

**起因不是對帳，是線上壞著**：前端每次開 App 打 `/daily-bonus` 都拿到 403，
訊息來自 **SigV4 解析器**（`Invalid key=value pair (missing equal-sign) in Authorization header`）。
🔴 **這個訊息會把人帶往錯的方向** —— 它讀起來像「那條路由的 auth 設定與別支不同」，
而我第一次就是這樣寫進設計冊的。真因是：`POST /daily-bonus` 活在 HTTP API
`3pmmlmvr5a`，而自訂網域 `ryojaku-api.boyplaymj.com` 的 basePath mapping
**只指向 REST `9mu0vajn38`** ⇒ 請求落到一支沒有這個資源的 API，
API Gateway 於是拿 `Authorization` 去當 SigV4 解析。
**「auth 設錯」與「路由不在這支 API 上」在那個 403 上長得一模一樣。**

**為什麼可以不等 §5 的前置條件**：那個條件的觸發點是 `HTTP_V2` **歸零**
（無 route 的 HttpApi 能不能過 CFN 未驗證）。只搬這一條之後 HTTP API 還剩四條
（`ANY /notifications`／`GET /ratings`／`POST /claim-push-bonus`／
`POST /registrations/{accept,reject}`）⇒ 不歸零，不觸發。**剩下七條仍受該條件約束。**

🔴 **搬路由只是一半，而另一半的失敗長得像「Lambda 壞了」**：
`mahjongclub_daily_bonus` 的 handler 是 `APIGatewayV2HTTPRequest/Response`。

| | 症狀 | 為什麼難查 |
|---|---|---|
| 回應端 | v2 結構多一個 `cookies` 欄位；REST proxy integration 只認 `statusCode`／`headers`／`multiValueHeaders`／`body`／`isBase64Encoded` ⇒ malformed ⇒ **502** | Lambda 那邊 `END` 正常、**零錯誤日誌**、2.21ms。「函式壞了」與「回應形狀不合規矩」在 CloudWatch 上逐字相同 |
| 請求端 | `RequestContext.HTTP.Method`、`AuthorizerUserIDV2` 讀的都是 v2 專屬欄位，餵 v1 事件時**靜靜取到零值** | 沒有例外、沒有日誌，只是每個請求都被判成未授權 |

⇒ **這七條之後要搬時，每一條都必須先確認 handler 的事件型別。**
判別法：`grep -n 'APIGatewayV2' <handler>/main.go`。有命中就要一起轉
（v1 的 `shared.AuthorizerUserID` 早就存在，auth.go:176）。

✅ **authorizer 沒有掉**：`daily-bonus` 本來就在 `gen_app_template.py` 的
`AUTHORIZER_PILOT` 裡，而 `authorizer_for()` **只認名字、不看 `apiType`**
⇒ 改 apiType 不會讓它變成裸端點。⚠️ 但這是**這一條**的事實，不是通則：
要搬的下一條若不在那份手工名單裡，搬過去就是無認證端點，**而漏列零錯誤訊號**。

**線上驗收（2026-09-10，四格）**：

| 檢查 | 結果 |
|---|---|
| 正控·合法 token `POST /daily-bonus` | **200**，`{"consecutiveDays":1,"pointsEarned":25,...}` |
| 反控 A·完全沒有 token | **401** `x-amzn-errortype: UnauthorizedException`（不再是 403 SigV4） |
| 反控 B·壞掉的 token | **401** ⇒ 擋下來的是簽章驗證，不是「有 header 就放行」 |
| 迴歸·`GET /chat/rooms` | 200 |

⚠️ 反控 B 不可省 —— 少了它，反控 A 的 401 與「authorizer 根本沒掛、是別的東西回的」分不出來。
⚠️ 正控**會真的領一次每日獎勵**（寫 `DailyClaims` ＋ `PointTransactions` ＋ `Users.points`），
對象是 stg 探針帳號 `APP_C1fARb3MMx0cp0j0`。重跑當天第二次會拿到「今天已領」而非 200。

⚠️ **只重 build `daily-bonus` 一顆，沒跑 `build_all.sh`** —— 後者會用當下工作樹
重建全部 84 顆，把別條 session 未提交的改動做成產物上線。
（部署前實證過 `build/` 最新 mtime `09-09 17:00:32` vs stack 最後更新 `09-09 17:02:53`
⇒ 當時產物就是線上那一份，沒有夾帶。）

### ✅ 單元尺：從「線上四格」到「可重跑的鑑別力」（2026-09-10 下午）

上面那四格是**線上**驗收 —— 它要真的部署上去才動得了，救不了「改回 v2 就靜靜壞掉」。
早上補的 `main_v1_contract_test.go`（T1～T5）把它拉回單元層，但**手動跑的四發突變裡
最重要的那發存活**：`userID := ""`（身分永遠讀不到）在 T1～T5 之下全綠 ——
T5 測的是 `shared.AuthorizerUserID` 這支**函式**，不是 handler 有沒有用它的結果；
而 T2 的「沒有 authorizer ⇒ 401」在那個突變下照樣成立。

⇒ 下午補完，兩件事：

| | 做了什麼 | 為什麼 |
|---|---|---|
| 可注入 | `dynamoClient` 由 `*dynamodb.Client` 改成 `ddbAPI` 介面；影子帳本那一步抽成 `recordShadowLog` 變數 | handler 一走過 401 那道閘，下一步就是碰真表 ⇒ 在此之前**結構上**寫不出這條測試 |
| 可重跑 | `backend/mutation_daily_bonus.sh`，15 發、逐發指名該紅的那一條 | 早上那四發只活在 commit 訊息裡，而**只寫在訊息裡的預期永遠不會失敗** |

新增 T6～T10：T6（帶合法身分走得完，且寫進去的 userID 就是讀到的那個）／
T7（昨天那筆要用**讀到的身分**當 key 才撈得到 ⇒ 連續第 7 天有加碼）／
**T8 是 T7 的反控**（換一個身分就真的撈不到 —— 少了它，T7 的 7 與「假件對任何 key
都回同一筆」逐字相同）／T9（401 之前一張表都不可以碰）／T10（日期是台北不是 UTC）。

🔴 **M4 只打「有沒有被判 401」，而那不是這個洞的全部。** M5～M9 打的是同一個洞的另外
幾面：身分讀對了，但拿去查別人的連續天數、把點數加到別人頭上、影子帳本記錯人 ——
這幾種在「有沒有 401」那把尺上全部是綠的。

⚠️ **界線**：`recordShadowLog` 在測試裡被整個換掉 ⇒ **它的函式本體仍然零覆蓋**
（它在補測試之前也是零覆蓋，所以不是退步，但也不可以因為「契約測試全綠」就讀成有尺）。
另外兩處還沒有尺的（連續天數 >7 的循環重置、交易失敗 ⇒ 409 那條路）寫在
`mutation_daily_bonus.sh` 檔頭。

⚠️ **這一輪沒有重新部署，也沒有重跑線上四格** —— 動的全是測試與可注入性，
handler 的線上行為未變（`go build` 過、整包 `go test` 綠）。要說「線上仍然好的」得重打一次。

#### ✅ Codex 覆驗回收（2026-09-10，`80af54b`）—— 而承重的是 sha，不是它報的數字

Codex 回「覆驗通過，沒有新增 finding」，附三個 `run_id`。回收 rc=0，三筆都在窗內。

🔴 **但「它真的跑了」與「它讀了我的報告」在措辭上分不開** —— 它報的
「M4 由 T6 指名殺掉」「15 發全數由預期測試殺掉」**每一個字都在我轉出去的原文裡**。
⇒ 這輪改用 `out_sha` 交叉比對（正典 `tools/verify-run/README.md` 的 out_sha 那節）：

| 載體 | 對方 | 我原樣重跑 | 判讀 |
|---|---|---|---|
| **突變腳本**（正控） | `2e633be3ed3a998a`／3871 B | **同 sha、同 bytes** | ✅ 那 3871 個位元組**不在**我轉出去的文裡（我只寫了「15 發全殺」五個字）⇒ 是它自己跑出來的 |
| 契約測試（反控 A） | `2ce3826867a5b332`／**73 B** | `295d3ba64f7cec1b`／**73 B** | ✅ 尺不是恆綠的 |
| 整包 lambdas（反控 B） | `c5b2b7156aaa8c8c`／7393 B | `c9c1388006be03b8`／7395 B | ✅ 同上 |

🔴 **反控 A 是這輪最值錢的一格：兩邊 `out_bytes` 同為 73，而 sha 不同。**
只看位元組數的話，一個內容不同的輸出會被判成相符。⇒ **`out_bytes` 不可代替 sha。**
（正典 README 已記過兩次，這是第三次，而這次兩邊長度完全相同、是最乾淨的一例。）

反控 A 的差異我另外定位過：對我的那 73 bytes 做**單一 token** 窮舉替換
（耗時欄 `0.000`～`9.999`，10000 個候選）**恰好命中 1 個** —— `0.006`（我是 `0.005`）。
⇒ 差異**只落在耗時那一欄**，套件路徑、`ok`、無 `-v` 全部相同。

✅ **正控的載體確實是確定性的，不是碰巧**：我連跑兩次，`2e633be3ed3a998a`／3871 B
逐位元組相同（含它內部那個 `0.006s`）⇒ 三次讀數一致（我 ×2 ＋ Codex ×1）。

🔴 **「誰跑的」承重的是行程祖先鏈，不是 `run_id` 也不是自陳欄位。**
那三筆的 `actor` 欄位是**空字串**（自陳沒填），而 `anc` 是
`bash/codex/node/codex-bridge/systemd` —— `check.sh` 判 `actor=codex` 讀的是後者。

⚠️ **界線三條**：①它證明「輸出相同」，不是「結論對」—— 我的測試若沒牙，兩邊會一樣綠。
②偵測不到主動造假（日誌是 append-only 的**約定**，不是強制）。
③**Codex 沒有重跑線上四格**（正確：那會真的替探針帳號領一次獎勵）⇒
「線上仍然是好的」這件事**這一輪仍然沒有人驗過**。

#### ✅ 線上四格重跑（2026-09-11）—— 而它先變成一支可重跑的探針

上面那段界線 ③ 寫著「線上仍然是好的」**這一輪仍然沒有人驗過**。這次補完了。

🔴 **先處理載體：那四格原本是手打 curl，結果只以表格形式存在於本檔。**
只寫在文件裡的驗收**永遠不會失敗** —— 跟本檔自己批評過的「四發突變只活在 commit
訊息裡」是同一個形狀。⇒ 先寫成 `infra/verify_daily_bonus_live.py`（11 格），再跑。

與原始四格的差異，兩處都是刻意的：

| | 原始四格 | 這支 | 為什麼 |
|---|---|---|---|
| 身分 | 真的 stg 探針帳號 `APP_C1fARb3MMx0cp0j0` | 合成 userId ＋ 自簽 token，跑完刪掉並 read-back | 原本會真的替真帳號領走一次獎勵，且**當天第二次就變 409** ⇒ 那把尺一天只能用一次，而「今天已領」與「端點壞了」在重跑時分不開 |
| 格數 | 4 | 11（多 G1b／G1c） | `200` 只證明「回了 200」，不證明寫進去了。handler 若整段跳過 transaction 直接 `successResponse`，原本那格照樣綠 |

- **G1b**：回頭 `GetItem DailyClaims`，比對 `points`／`consecutiveDays` 與回應相符。
- **G1c**：同一身分**再打一次**必須 **409** ⇒ 條件式寫入真的擋得住。
- **G1 的 `pointsEarned` 不寫死 25**，改成自己去 `AdminConfigs` 讀
  `Activity:DailyBonusBase` 再比。寫死的話，哪天後台改基礎點數這格會紅，
  而它紅的理由與「端點壞了」逐字相同。（實測讀到 25，與 09-10 手打那格相符。）

**讀數**：

| 輪次 | 結果 |
|---|---|
| **反控**·同一支打 `HttpApiUrl`（`/daily-bonus` 已不在那邊） | **0/11 紅**，rc=1 ⇒ 這把尺不是恆綠的 |
| 正式·打 `RestApiUrl` | **11/11 綠**，rc=0 |
| **同日立刻重跑第二次** | **11/11 綠**，rc=0 ⇒ 「想跑幾次跑幾次」量到了，不是宣稱 |
| 正式·打自訂網域 `ryojaku-api.boyplaymj.com`（App 實際用的那一份） | **11/11 綠**，rc=0 |

🔴 **反控那一輪不可省。** 沒有「部署前」可比（這一版 09-10 下午就上去了，之後沒再動），
所以改用「打一個該打不到的 base」當等價物 —— 少了它，11/11 與「探針恆綠」逐字相同。
（規矩來自同目錄的 `verify_venue_privacy_live.py`：只跑綠的那一次證明不了任何事。）

**殘留**：三張表各掃一次 `begins_with(pk, 'DB4PROBE-DELETEME')` 都是 **0**；
反控（前綴換成空字串 ⇒ Users 6 列）證明那把掃描不是恆零。
⚠️ 兩張表的 PK 名字**不一樣**（`DailyClaims` 是 `userID`、`PointTransactions` 是 `userId`），
探針裡那兩個常數是從 `describe-table` 的 KeySchema 抄的，不是從 Go struct ——
抄錯一邊刪不掉而且**不會報錯**。

✅ **順帶量到一件本檔標為未知的事**：影子帳本那筆**有出現**（兩輪各 1 列）。
`go recordShadowLog(...)` 在回應之後才跑，先前不確定 Lambda 會不會先凍結。
⚠️ 但探針**不把它當斷言**，只印觀測值 —— 兩次出現不構成「它一定會記」，
而把它變成斷言會讓一個時序競態變成間歇假紅。

⚠️ **界線**：本支驗的是「線上那份 Lambda 收得到身分、回得了 v1 形狀、寫得進三張表」。
連續天數 >7 的循環重置、交易失敗那條路仍然只有單元層
（`backend/mutation_daily_bonus.sh`）。**兩個 base 都打過了**（`RestApiUrl` ＋ 自訂網域），
所以「base path mapping 指到舊 stage」那個坑這一輪是綠的 ——
那條規矩來自 `verify_ruleset_live.py` 用同一個坑換來的，不是推測。

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

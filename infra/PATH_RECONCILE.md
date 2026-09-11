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

### 📋 §5 前置②：五支 handler 的事件型別掃描（2026-09-11）

設計冊先前寫「這七條之後要搬時，每一條都必須先確認 handler 的事件型別」。掃完了。
⚠️ **實際是五支不是七條**（`HTTP_V2` 現況 5 支，名單由 manifest 現算，不是手打）。

**結論：五支全是 v2。** 所以這不是「只改 manifest」的事 —— 每一支都要轉 handler。

🔴🔴 **下表是 2026-09-11 訂正後的版本（83＋3＝86）。舊版寫 79＋3＝82，漏了一整欄
`RecordTokenUsageFromHeaderV2` —— Codex 覆驗抓到的。為什麼會漏見本節末尾。**

| handler | auth | V2Req | V2Resp | `RC.HTTP.Method` | `RC.HTTP.Path` | `AuthorizerUserIDV2` | `RecordTokenUsageFromHeaderV2` | 小計 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `get_ratings` | public | 1 | 6 | 1 | 0 | 0 | 1 | **9** |
| `notifications` | user | 3 | 13 | 4 | 1 | 1 | 1 | **23** |
| `reject_registration` | user | 1 | 13 | 2 | 1 | 1 | 1 | **19** |
| `accept_registration` | user | 1 | 17 | 2 | 1 | 1 | 1 | **23** |
| `claim_push_bonus` | user | 1 | 6 | 1 | 0 | 1 | 0 | **9** |
| | | 7 | 55 | 10 | 3 | 4 | 4 | **83 處** |

**六種機械替換**（v1 對應物都已存在，不必新寫）。可原樣照抄：

```bash
FILES=$(for d in get_ratings notifications reject_registration \
                 accept_registration claim_push_bonus; do
          echo backend/cmd/lambdas/apis/mahjongclub_web_$d/main.go; done)
sed -i \
  -e 's/events\.APIGatewayV2HTTPRequest/events.APIGatewayProxyRequest/g' \
  -e 's/events\.APIGatewayV2HTTPResponse/events.APIGatewayProxyResponse/g' \
  -e 's/request\.RequestContext\.HTTP\.Method/request.HTTPMethod/g' \
  -e 's/request\.RequestContext\.HTTP\.Path/request.Path/g' \
  -e 's/shared\.AuthorizerUserIDV2(/shared.AuthorizerUserID(/g' \
  -e 's/shared\.RecordTokenUsageFromHeaderV2(/shared.RecordTokenUsageFromHeader(/g' \
  $FILES
```

對應的 v1 函式都早就存在：`shared.AuthorizerUserID`（`auth.go:176`）、
`shared.RecordTokenUsageFromHeader`（`token_stats.go:120`）。兩者都只讀 Authorization header。

**已在隔離 worktree 實作過一次**（`git worktree add --detach`，不動共用工作樹）：
六條套完 `go build` rc=0、`go vet` rc=0、`go test` 五個套件通過
（`accept_registration` ok，其餘 `no test files`）。**改動未落到共用工作樹，worktree 已移除。**

🔴 **加上三處註解，共 86 處。** 用上面五條 sed 把 79 處消掉之後，
`notifications:116`／`reject_registration:94`／`accept_registration:97` 仍留著
「本支是 **HTTP_V2**，故用 `AuthorizerUserIDV2`」——**搬完那句話就是假的**，
而它會主動把下一個讀的人指向錯的方向。
⚠️ 這三處是靠「把樣式 sed 掉之後看殘量」才浮出來的，不是靠讀程式看到的。
🔴🔴 **但「殘量法證明了樣式涵蓋完全」那句話是假的，訂正見下。**

**四件已查清、不必擔心的事**（每一件都附怎麼查的）：

1. **裸端點風險 0。** `authorizer_for()` **只認名字、不看 `apiType`**，五支裡四支
   `auth=user` 的都在 `AUTHORIZER_PILOT`（34 支）裡，`get-ratings` 是 `public`
   （線上實測不帶 token 回 400 業務錯誤，不是 401 ⇒ 確實不需認證）。
   🔴 **反控**：全 manifest `auth=user` 共 41 支，`authorizer_for()` 回 `None` 的有
   **7 支**（`chat-ws-connect`／`chat-ws-send-message`／`redeem-code`／
   `auth-change-password`／`auth-logout-all`／`auth-bind-google`／`auth-unbind`）
   ⇒ 這把尺不是恆真的，上面那個「0」才有意義。
   ⚠️ 那 7 支本身是另一件事（前三支是 WS／Lambda URL，機制不同；後四支是 REST_V1
   而 `authorizer_for` 回 None，**本輪沒查它們是不是在 handler 內自己驗 token**）。
2. **路由形狀不變。** manifest 的 `path` 帶尾綴 `?`（如 `/ratings?`），
   產生器 `rstrip("?")` 後兩個分支共用同一份 `paths`；差別只有
   `RestApiId:!Ref RestApi` vs `ApiId:!Ref HttpApi`、`Method` 大小寫、事件名 `Rest{i}`/`Http{i}`。
3. **不會打到既有測試。** 只有 `accept_registration` 有 `main_test.go`，
   而它 `APIGatewayV2` 命中 **0** 次（測的是 `buildAcceptTransactItems` 那些純函式）。
4. **沒有跨套件引用。** 五個目錄各自被外部檔引用 **0** 處。

**回應端那個 502 的坑不適用**：五支都沒有用到 `Cookies`（實測 0 處），
所以 v2→v1 只是型別替換，不是要拿掉欄位。

#### 🔴 為什麼會漏掉一整欄：殘量法的偵測器是我手寫的清單（2026-09-11 訂正）

第一版報「79＋3＝82、五種替換」，而正確答案是「83＋3＝86、六種」。
漏掉的是 `shared.RecordTokenUsageFromHeaderV2(...)`（4 支各 1 處）。

**它是 Codex 覆驗抓到的，不是我的殘量法抓到的 —— 而我當時把殘量法當成涵蓋性的證明。**

殘量法長這樣：把已知的樣式 sed 掉，再 `grep` 看還剩什麼。問題在那個 `grep` 的樣式：

```
grep 'APIGatewayV2\|RequestContext\.HTTP\|AuthorizerUserIDV2'
```

⇒ **那是一份手挑清單。** `RecordTokenUsageFromHeaderV2` 這三條一條都不符
（它含 `V2` 但不含 `APIGatewayV2`），所以它在殘量裡**結構上不可見**，
而「偵測不到」與「不存在」在輸出上逐字相同。
我卻據此寫下「殘量法同時證明了那五條樣式涵蓋完全」—— **用一份手挑清單證明手挑清單完整**。

🔴 **而權威的尺一直都在，只要 1.5 秒：`go build`。**
型別不相容是編譯器的職責，不是 regex 的。實證（在隔離 worktree 裡做的對照）：
只套原本那 5 條之後 `go build` **rc=1，逐行點名那 4 處**，一個不多一個不少；
補上第 6 條之後 rc=0、`go vet` rc=0。
⇒ 教訓不是「regex 要寫寬一點」（寬到 `V2` 會撈到 `DynamoDB V2` 那種無關註解），
是**有權威的尺就不要用近似的**。
判別法：問「這個宣稱如果錯了，誰會出聲」——答案是編譯器，那就去跑編譯器。

⚠️ 順帶一個同形狀的：訂正時我用 `git show HEAD:cmd/lambdas/...` 重數，
少了 `backend/` 前綴 ⇒ `git show` 回空字串、**每一格都是 0**，
而那與「真的一處都沒有」逐字相同。加 `assert returncode==0 and len>500` 才炸出來。
**不檢查 returncode 的讀取，回空時會靜靜變成一個好看的零。**

### ✅ §5 步驟③ 已做到「可部署狀態」（2026-09-11）—— **尚未 `sam deploy`**

handler 六條 sed（83 處）＋ 三處註解 ＋ manifest 五支 `HTTP_V2`→`REST_V1` ＋ 重跑產生器，
全部落到工作樹並提交。**部署沒有做**，理由見本節末。

**程式面**：

| 尺 | 讀數 |
|---|---|
| 六種樣式套用後殘量 | 六種**全 0**（套前 7／55／10／3／4／4＝83，git `--numstat` 73 行對得上） |
| 寬偵測器（掃 `V2`）| 只剩 5 行，全是**正確**陳述（描述本次改判）＋1 行無關的 `DynamoDB V2` |
| `go build ./...`（整包） | **rc=0**（19.9s） |
| `go vet ./...` | **rc=0** |
| `go test ./...` | **rc=0**（`accept_registration`／`shared` 實跑，其餘 cached／無測試檔） |

⚠️ **範圍刻意放大到整包** —— 前一輪只跑那五個套件。雖然已查過「零跨套件引用」，
但那個「零」是我 grep 出來的，而 `./...` 是編譯器算的。**同一個教訓的第二次應用。**

**樣板面**——預演時寫下的預測，這次逐項驗證：

| 樣式 | 現在 | 基線 | 預演時的預測 |
|---|---:|---:|---:|
| `Type: AWS::Serverless::HttpApi` | 0 | 1 | 0 |
| `!Ref HttpApi` | 0 | 5 | 0 |
| `${HttpApi}` | 0 | 2 | 0 |
| `HttpApiUrl` | 0 | 1 | 0 |
| `AuthorizerHttpApiPermission` | 0 | 1 | 0 |
| `Type: Api`（REST 路由） | **80** | 75 | 80 |
| `Type: HttpApi` | 0 | 5 | 0 |
| 行數 | **2863** | 2896 | 2863 |

**八項全部命中。** 預測是在改動之前寫下的（前置①的乾跑），所以這不是事後對答案。

**五條路由的落點**（不只看「HttpApi 消失了」，要看它們**去了哪裡**）：

| 路由 | 掛在 | Method | Authorizer |
|---|---|---|---|
| `/ratings` | REST | `get` | **（無）** —— 與 manifest `auth=public`、線上實測回 400 業務錯誤一致 |
| `/notifications` | REST | `any` | `RyojakuUserAuth` |
| `/registrations/reject` | REST | `post` | `RyojakuUserAuth` |
| `/registrations/accept` | REST | `post` | `RyojakuUserAuth` |
| `/claim-push-bonus` | REST | `post` | `RyojakuUserAuth` |

**cfn-lint**（`regions=[ap-southeast-1]`）：基線 0 則、新產出 0 則。
🔴 **同一輪的反控**：把 `/notifications` 改回 `ApiId: !Ref HttpApi`（＝搬到一半）
⇒ **1 則 E0001**（`property ApiId not defined for resource of type Api`）⇒ 尺有牙。
⚠️ 精確地說這一輪驗的是「半途而廢的路由」；「懸空引用」那個洞是**上一輪**在基線上驗的
（5 則 E0001）。兩者是不同的失效模式，不要互相代替。

#### 🔴 為什麼停在這裡，沒有 `sam deploy`

風險不在這次改動，在部署的機制：`build_all.sh` 會用**當下工作樹**重建全部 84 顆
⇒ 這台機器上別條 session 的未提交改動會被做成產物上線
（`deploy.sh 打包工作樹` 那個已知坑）。而 `build/` 現在是**舊的**
（還是 v2 版本的 bootstrap）⇒ 只 `sam deploy` 不重 build 的話，
樣板說「REST 路由」而 Lambda 裡跑的仍是 v2 handler
—— **那正是 `/daily-bonus` 踩過的 502／靜靜未授權那一組症狀**。

⇒ 部署要做的是一個獨立決定，必須先處理「怎麼只 build 這五顆、或怎麼確認工作樹乾淨」。

**部署後的驗收已經有現成的反控組**：本檔上一節量到的
「五條在自訂網域上全部 403」就是 **before 讀數**，部署後應變成 401／200
（`/ratings` 是 public ⇒ 應為 200 或 400 業務錯誤，不是 403）。

### 🔎 部署前的查證：`build_all.sh` 不能挑，而且它會多帶一顆（2026-09-11）

**問題**：能不能只 build 我改的那五顆？

**答**：`build_all.sh` **不行** —— 它 23 行，`find ./cmd/lambdas -name main.go | sort`
無條件全建，沒有任何選擇參數。但那個迴圈只有 6 行，用**同樣的旗標**
（`GOOS=linux GOARCH=arm64 CGO_ENABLED=0 -tags lambda.norpc -ldflags='-s -w'`，
產物名 `<dir 去掉 ./cmd/lambdas/，/ 換成 __>/bootstrap`）另寫一支是小事。
前例：09-10 就「只重 build `daily-bonus` 一顆」做過。

🔴 **但真正的理由不是省時間，是 `build_all.sh` 會多帶一顆上去。**

逐顆比對「產物 mtime」與「該目錄非測試 `.go` 的最後 commit 時間」，84 顆裡 **6 顆 stale**：
我改的那五支（落後 32.5 小時）**外加 `mahjongclub_daily_bonus`（落後 1.3 小時）**。

`daily_bonus` 不是尺的假陽性：`80af54b`（09-10 07:11）真的改了 `main.go` **81 行**
（`dynamoClient` 改成 `ddbAPI` 介面、`recordShadowLog` 抽成變數），而產物停在 05:52。

✅ **用控制組確認過，不是符號被 `-s -w` 剝掉**：

| 符號 | 現建（同旗標） | `build/` 那份 | 判讀 |
|---|---:|---:|---|
| `ddbAPI` | **1** | **0** | ⇒ 那份確實是 `80af54b` 之前的 |
| `DailyClaims` | 1 | 1 | 反控：`strings` 讀得到兩個檔 |
| `TransactWriteItems` | 44 | 43 | 同上 |
| `recordShadowLog` | 0 | 0 | ⚠️ **不是每個識別字都活得過 `-s -w`** —— 所以上面那個控制組不是多餘的 |

⇒ **跑 `build_all.sh` ＋ `sam deploy` 會順手把 `80af54b` 第一次推上線。**
那是一個**沒有人做過的決定**（設計冊當時寫的是「動的全是測試與可注入性，
handler 的線上行為未變…要說『線上仍然好的』得重打一次」）。
⚠️ 而本輪 `/daily-bonus` 線上四格 11/11 全綠，量的是**部署中那一版**，
不是 `80af54b` 那一版 —— 兩者不可互推。

**另外三件查清楚的**：

1. `deploy_app.sh` **不呼叫** `build_all.sh`（只 `sam deploy -t 02-app.generated.yaml`）
   ⇒ build 是獨立的手動步驟，不會被部署自動帶起來。
2. 🔴🔴 **訂正我自己上一節寫的**：`build_all.sh` 讀的是**寫死的**
   `/opt/sml/ryojaku-src/backend` ⇒ 「夾帶未提交改動」的風險範圍**只有這棵樹**。
   我上一節寫「此刻 `/opt/sml/ryojaku-src` 以外的 repo 都有大量未提交檔案」——
   那句話與這個風險**無關**，是錯的引用。而這棵樹**此刻是乾淨的**（0 未追蹤／0 已修改）
   ⇒ 現在跑 `build_all.sh` 建的就是 HEAD。
   ⚠️ 但那是**此刻**的讀數，不是恆定狀態 —— 別條 session 隨時可能弄髒它，
   所以「build 之前再看一次 `git status`」仍然要做。
3. ⚠️ `build_all.sh` 寫死 `/opt/sml/ryojaku-src`（`BACKEND`／`OUT` 兩行）
   ⇒ 在 `git worktree` 裡跑它會去建**主工作樹**。本輪沒有因此受害
   （我在 worktree 裡用的是 `go build` 不是這支），但這是 CLAUDE.md 🌲 那條的形狀。

### 🚀 §5 已部署（2026-09-11）—— 使用者拍板全建，等於同時把 `80af54b` 首次推上線

決定是使用者做的：上一節列出「只 build 五顆／先處理 daily_bonus／全建」三條，選了**全建**。
⇒ 本次部署**同時**送出 §5 的五支，與 `daily_bonus` 那顆掛了 32 小時沒上線的 refactor。

**過程與讀數**：

| 步驟 | 讀數 |
|---|---|
| build 前 race 檢查 | 工作樹 0 未追蹤／0 已修改，HEAD `af46d6e` ⇒ 建的就是 HEAD |
| `build_all.sh` | **`DONE ok=84 fail=0`** |
| 產物新鮮度 | **84/84**（`find -newermt` ＋ python `getmtime` 兩個獨立方法一致） |
| 五支的 v2 符號 | `APIGatewayV2HTTPRequest`／`RecordTokenUsageFromHeaderV2`／`AuthorizerUserIDV2` **全 0**（部署前 notifications 是 16／1／1） |
| ↳ **反控** | `APIGatewayProxyRequest` 各 3、`RecordTokenUsageFromHeader` notifications 1 ⇒ 那些 0 不是符號被 `-s -w` 剝掉 |
| `daily_bonus` | `ddbAPI` **1**（部署前 0）⇒ `80af54b` 確實進了產物 |
| `sam deploy` | **rc=0**，`Successfully created/updated stack` |
| CFN 事件 | **`DELETE_COMPLETE  AWS::ApiGatewayV2::Api  HttpApi`** ⇒ HTTP API 整個消失 |
| Outputs | 只剩 `RestApiUrl`＋`WebSocketUrl`，**`HttpApiUrl` 不見了** ⇒ 前置①的條件化真的生效 |

**驗收 —— before 讀數是本檔上一節量的，所以這是真正的前後對照**：

| 路徑（打自訂網域 `ryojaku-api.boyplaymj.com`） | before | after |
|---|---:|---|
| `POST /claim-push-bonus` | 403 | **401** `Unauthorized` |
| `POST /registrations/accept` | 403 | **401** |
| `POST /registrations/reject` | 403 | **401** |
| `GET /notifications` | 403 | **401** |
| `GET /ratings`（public） | 403 | **400** 業務錯誤「必須提供 gameId」 |
| `GET /chat/rooms`（**正控**·本來就在 REST） | 401 | **401（未變）** |

🔴 **正控那一列不可省**：它證明變的是這五條，不是整體漂移。

🔴 **但 401 只證明「路由在、匿名被擋」。** 所以補一格**帶合法 token** 的正控
（合成 userId ＋自簽 token，跑完刪掉並 read-back）：

- `GET /notifications` ＋ token → **200** `{"success":true,"unreadCount":0,"hasMore":false}`
- 同一刻、同一條、**不帶 token** → **401**

⇒ v1 轉換後的 handler **讀得懂請求、也回得出 v1 形狀**（沒有 502，也沒有「靜靜判成未授權」）
—— 那正是 `/daily-bonus` 踩過的兩種症狀，這次兩種都沒發生。

**舊 base 已不可達**：`https://3pmmlmvr5a.…` 六條全部連線錯誤（API 已刪）。

**其他兩張網**（部署動了全部 84 顆，blast radius 遠大於改動）：

- `verify_daily_bonus_live.py`：`RestApiUrl` **11/11**、自訂網域 **11/11**
  ⇒ **`80af54b` 第一次上線，也是第一次有人在線上驗過它。**
- `security_regression.sh`：**36/36**，rc=0，測試資料已清空。

#### ⚠️ 刪掉 HttpApi 的下游後果（兩支驗證腳本寫死了那個 id）

`3pmmlmvr5a` 這個 id **永久消失**。全 repo 掃過，寫死它的有兩支：

| 檔 | 狀態 | 處置 |
|---|---|---|
| `verify_cors_browser.py:58` | **活的** —— 那格打 `{HTTP}/registrations/accept` | 改打 `{REST}`，並刪掉 `HTTP` 常數 |
| `verify_admin_role_gate.py:39,155` | **死碼** —— `TARGETS` 15 項全是 `"V1"`，`kind=="V2"` 走不到 | `HTTP_BASE = None`，且 `kind=="V2"` 改成 **fail-loud `SystemExit`** |

🔴 `HTTP_BASE` 那支**不可以只把常數刪掉了事**：留著一個指向不存在 host 的 base，
哪天真的有人加一條 V2，拿到的會是**連線錯誤**，而那讀起來像「端點壞了」。
現在它會明講「HTTP API 已刪除，請改成 V1」。

⚠️ **`verify_cors_browser.py` 我沒有跑**（它是瀏覽器 E2E）。
`verify_admin_role_gate.py` **也沒有整支跑** —— 它的 `TARGETS` 含 `POST /admin/push-all`
且會帶 **admin token** 真的打過去，那是對外、不可逆的副作用。
改用 import 的方式驗：`TARGETS` 的 `kind` 取值只有 `['V1']`
⇒ 我改的那行**對現況等價**（原本走 `REST_BASE`，現在也走 `REST_BASE`）；
並實際呼叫 `http_probe(..., "V2", ...)` 確認那道 `SystemExit` **真的會炸**（不是寫了沒接上）。

**仍未驗**：`/registrations/accept`／`reject`／`claim-push-bonus` 只驗到「帶 token 時
authorizer 放行」這一層是靠 `/notifications` 那格推的 —— 這三條**本身**沒有帶 token 打過
（它們會寫資料：核准報名／否決報名／領取推播獎勵）。

#### ✅ 補驗：三條寫入型路由的帶 token 路徑（2026-09-11，`verify_migrated_routes_live.py`）

上一節結尾標的「仍未驗」與覆驗者列的未跑項，是同一格。補完了，而且**零寫入**。

🔴 **這個缺口為什麼要命**：v2→v1 沒轉乾淨的兩種症狀，**都不會出現在匿名探測上** ——
①回應端形狀不合 ⇒ REST proxy 判 malformed ⇒ **502**（Lambda 那邊零錯誤日誌）；
②請求端讀 v2 專屬欄位 ⇒ 取到零值 ⇒ **每個請求都被判成未授權**，
而症狀②長得跟「authorizer 正常運作」**一模一樣**。匿名打過去本來就該 401。

**零寫入是讀 handler 早退路徑讀出來的**，不是猜的：
`accept`／`reject` ＋不存在的 `registrationId` → `getRegistration` 失敗 → 404 早退；
`claim-push-bonus` ＋沒有推播訂閱的合成使用者 → 400 早退。
⇒ 只建一列合成 `Users`（跑完刪掉並 read-back），三條路由本身不產生任何資料。

**承重的是 G3，不是 G1/G2**：

| 格 | 讀數 |
|---|---|
| G3a `POST /registrations/accept` body `{}` | **400** `{"error":"Missing registrationID parameter"}` |
| G3b 同一 token，body 帶不存在的 id | **404** `{"error":"找不到此報名紀錄"}` |
| G3c | 兩種 body **不同狀態碼** ⇒ **v1 的 `request.Body` 真的被讀到了** |

🔴 少了 G3c，「body 讀得到」與「body 永遠是空的、一律 400」分不出來 ——
而後者正是 v1/v2 欄位搞錯時的典型形狀。`reject` 同樣 400 vs 404。

**其餘各格**：G0 `/notifications`＋token → 200（**撐整組** —— token 簽壞／SSM 讀錯／
authorizer 掛掉時 G1~G4 會全部變 401，而每一條都符合某個「應該被擋」的期望，
少了 G0 一個全壞的系統可以讓這支全綠）；G1 三條無 token → 401；
G2 壞 token → 401（撐著 G1）；G4 `claim-push-bonus`＋token → **400
「請先開啟推播通知權限唷！」** ⇒ 讀到了身分、也查了訂閱表。

⚠️ **每一格都同時擋掉 401 與 502**（見 `grid()`）。只斷言「等於預期碼」的話，
502 會被寫成「不等於 404」，讀起來像業務邏輯變了。

**讀數**：

| 輪次 | 結果 |
|---|---|
| **反控**·打已刪除的 HttpApi base | **0/14 紅**，rc=1（清理仍歸零）⇒ 尺不是恆綠的 |
| 自訂網域 `ryojaku-api.boyplaymj.com` | **14/14**，rc=0 |
| `RestApiUrl` 直連 | **14/14**，rc=0 |

**殘留**：三次跑共建 3 列合成 `Users` ⇒ 掃描 `begins_with(userId,'MIGPROBE-DELETEME')` = **0**
（反控：空前綴 = 6）；`Registrations` 表含 `MIGPROBE` 的 = **0** ⇒ 零寫入這句是量到的。

#### 📌 覆驗回收（`fwd-1547908011140452405-…`）—— 這一輪只證明了「它跑了」

Codex 回「覆驗通過，沒有新增 finding」，附兩個 `run_id`，回收 rc=0、
祖先鏈 `bash/codex/node/codex-bridge/systemd`、cwd `/opt/sml/ryojaku-src`。

🔴 **但它報的每一句都在我轉出去的原文裡**（五條 401／400、`/chat/rooms` 401、
V2 分支 fail-loud）⇒ 內容上「它真的跑了」與「它讀了我的報告」分不開。
而 `out_sha` 交叉比對這次**用不上** —— 那兩條是它自己寫的指令，我手上沒有，
無法原樣重跑（試了 5 個 argv 候選都對不上 `argv_sha`）。
⇒ 誠實的說法是：**祖先鏈證明它跑了，內容沒有被獨立驗證。**
我另外自己重量了那六格（部署後約 40 分鐘），讀數不變。

### ✅ 那 7 支「`authorizer_for()` 回 None」查完了：不是裸端點，是 in-handler 驗證（2026-09-11）

§5 盤點留下的問題：全 manifest `auth=user` 共 41 支，`authorizer_for()` 回 `None` 的有 7 支。
那個組合讀起來像「標了要登入、卻沒掛閘」。**查完了：四支 REST_V1 已線上實測（24 格），
另三支只讀原始碼。**

🔴 **最初讓我起疑的不是清單，是不對稱**：姊妹端點 `auth-bind-line` **在**
`AUTHORIZER_PILOT` 裡，而 `auth-bind-google` 不在。兩支做同一件事，一支有閘一支沒有。

**原始碼鏈（四支相同）**：
`shared.GetUserIdentifierWithContext` → `VerifyTokenWithUserPwGate` → `VerifyToken`
（`jwt.ParseWithClaims` ＋ **拒絕非 HMAC signing method** ＋ `token.Valid`，
外加密碼變更撤銷閘）。查詢參數 `?userId=`／`?lineID=` 那條 fallback 回 `fromJWT=false`，
四支全部據此 401 —— 那正是它們註解裡那句「安全鐵律：絕不接受 query param userId」。

**但讀原始碼只是假設**，所以寫了 `infra/verify_auth_inhandler_gate.py` 去量。

🔴🔴 **2026-09-11 訂正（覆驗者抓到）：v1 只量了四支裡的一支。**
`PROBE = "/auth/unbind"` 是**寫死的單一常數**，而我把結論寫成「四支 REST_V1 的有實測」——
**驗證範圍小於宣稱範圍**。正確的說法當時應該是「四支原始碼同一條驗證鏈，
且 `unbind` 一支線上 8/8 證實」。
⇒ 現已改成表驅動、四支全打，**8 格 → 24 格**。下表是 `unbind` 那一組（其餘三支同形狀）：

| 格 | 讀數 |
|---|---|
| A5（**撐整組**）合法 token | `POST /auth/unbind` → **400** `unsupported provider` ⇒ 過了身分閘、走到業務邏輯 |
| A1 什麼都不帶 | 401 |
| **A3（承重）只帶 `?userId=<身分>`** | **401** |
| A3b 只帶 `?lineID=<身分>` | **401** |
| A4（撐 A1/A3）**用錯金鑰簽的 token** | **401** ⇒ 真的有在驗簽，不是一律 401 |
| A6 對照組 `/auth/bind-line`（有掛 authorizer） | 401 |
| A6b 同上 ＋ `?userId=` | 401 |
| **A7（承重）兩種 401 的 body 必須不同** | in-handler `{"error":"unauthorized","success":false}`（**handler 自己的格式**）vs gateway `{"message":"Unauthorized"}` |

🔴 **A3 才是那句「安全鐵律」真正宣稱的東西。** 少了它，A1（什麼都不帶 → 401）與
「fallback 其實會放行」**相容** —— 因為 A1 連 query param 都沒給，那條路徑根本沒被求值。

🔴 **A7 是「in-handler 真的有閘」的直接證據。** 少了它，「in-handler 有驗」與
「其實也被某個 authorizer 擋掉了」**在狀態碼上逐字相同**（都是 401）。
body 形狀不同 ⇒ A1/A3/A4 是**進到 Lambda 之後**才被擋。

**四支的 A5 期望值逐支不同**，因為各自身分閘之後的第一個出口不同 ——
**不可以統一寫成「非 401 即可」**，那會讓「400 是因為 body 壞」與「400 是因為別的東西壞了」混在一起：

| 端點 | A5 送什麼 | 期望 | 為什麼 | 實得 |
|---|---|---:|---|---|
| `/auth/unbind` | 壞 JSON | 400 | 身分閘後下一步是 `json.Unmarshal`（`main.go:46`） | 400 `invalid request` |
| `/auth/change-password` | 壞 JSON | 400 | 同上（`main.go:95`） | 400 `invalid request body` |
| `/auth/bind-google` | 壞 JSON | 400 | 同上（`main.go:47`） | 400 `missing idToken` |
| `/auth/logout-all` | `{}` | **200** | **沒有 body 解析**，過閘即 `UpdateItem`（`main.go:103`） | 200 `{"success":true}` |

**新增 A8 涵蓋率閘**，而它存在的理由就是 v1 那個缺陷：
宣稱四支而程式只打一支時，**輸出讀起來完全正常**（每一格都綠，只是全都落在同一個 path 上）。
⇒ `req()` 每打一次記一個 path，跑完拿它跟 `ENDPOINTS` 對帳。
✅ **這道閘有被打過一發突變**：把迴圈改成 `ENDPOINTS[:1]`（＝v1 的形狀）⇒
A8 轉紅並精確點名漏掉的三支，rc=1。
🔴 **但 A8 量的是「探針有沒有去打」，不是「打到了」** —— 反控（打已刪除的 base）時
**24 格裡只有 A8 是綠的**（主機不存在，每個請求都失敗，而 `HIT` 照樣被填滿）。
那是它該有的行為，但**標籤不可以寫成「四支全部驗過」**，單獨被引用時會被讀成那樣，
所以訊息裡明寫「本格不保證打得到」。

**讀數**：自訂網域 **24/24** rc=0；**反控**（打已刪除的 HttpApi base）**1/24** rc=1
（那 1 格是 A8，理由如上）；兩輪清理都歸零。

#### 結論與界線

- **不是裸端點。** 兩種閘在「擋不擋得住」上讀數相同。
- ⚠️ **差別在「誰先擋」**：authorizer 擋在 Lambda **之前**（匿名請求不進 Lambda），
  in-handler 是**每一則都進**。那是**成本與攻擊面**的差別，不是「有沒有驗」的差別。
  本輪沒有替這個差別估過量級。
- ⚠️ **本支答的是「有沒有驗身分」，不是「授權邏輯對不對」**（例如能不能解綁**別人**的帳號）。
  那是另一件事，**沒驗**。
- 另三支：`chat-ws-connect`／`chat-ws-send-message` 是 `WEBSOCKET`（機制不同，本輪未查）；
  **`redeem-code` 是 `LAMBDA_URL` 且 CFN 裡是 `FunctionUrlConfig: { AuthType: NONE }`**
  —— 但 handler 內同樣呼叫 `shared.VerifyTokenWithUserPwGate`（`main.go:135`，
  註解明寫「與 API Gateway authorizer 同一套驗證」）⇒ 同一個形狀。
  ⚠️ **這支只讀了原始碼，沒有線上量過。**
- ⚠️ **量錯對象的坑，這輪踩了一次**：`ls -d backend/cmd/lambdas/apis/*redeem*` 撈到的是
  `mahjongclub-redeem`，而 manifest 指的是 `mahjongclub_web_redeem_code` ——
  **兩個目錄都存在**，我第一次 grep 的是沒有被部署的那個（結果是「只有一行 401、看不到驗證」，
  讀起來就像裸端點）。⇒ 路徑一律從 manifest 取，不要用萬用字元撈。

### ✅ 授權層：拿到合法身分之後能不能動別人的東西（2026-09-11）

`verify_auth_inhandler_gate.py` 的界線寫著「本支答的是有沒有驗身分，不是授權邏輯對不對」。
補那一半，新增 `infra/verify_registration_authz_live.py`（7 格）。

**`/auth/*` 那四支：答案是結構性的，不需要線上量。**
`unbindRequest{Provider}`／`changePasswordRequest{CurrentPassword,NewPassword}`／
`bindRequest{IDToken}`／`logout-all` **連 request struct 都沒有**
⇒ **沒有任何欄位可以指定別人**，目標一律是 JWT 來的 `userID`
（`main.go` 各處都是 `"userId": …Value: userID`）。那比執行期檢查更強。

**真正有 IDOR 面的是 §5 剛搬過來的兩條**：`/registrations/{accept,reject}` 吃的
`registrationId` 屬於**某個人的局**，靠 `game["hostUserId"].(string) != userID → 403` 擋。

**讀數**（主揪 A 開局、路人 B 報名，同一筆 `registrationId`）：

| 格 | 讀數 |
|---|---|
| Z0（撐整組）兩把 token 都可用 | `GET /notifications` 各 200 |
| **Z1 路人 `POST /registrations/accept`** | **403** `只有主揪可以接受報名` |
| **Z1 路人 `POST /registrations/reject`** | **403** `只有主揪可以拒絕報名` |
| **Z3（承重的另一半）主揪對同一筆** | **200** `✅ 已接受報名` |
| Z4 狀態改成 accepted 後路人再試 | **403**（⇒ 擁有權檢查排在狀態檢查**之前**） |
| Z5 涵蓋率閘 | 兩支都真的發過請求 |

🔴 **Z3 不可省**：端點整支壞掉、或那條路由根本不存在時，**每一個人都會拿到 403**。
讓主揪對**同一個 `registrationId`**在同一輪拿到 200，那一對才把
「不是主揪」與「誰來都不行」分開。

🔴🔴 **403 一定要連 body 一起斷言 —— 而這件事本檔自己有前科。**
這套 API 上 403 至少有兩種來源：①擁有權檢查 ②**API Gateway 對不存在的路由**
（§5 搬遷前那五條的 403 正是②）。只看狀態碼的話，「授權閘擋住了」與「這條路由根本不在」
**逐字相同**。
✅ **判準本身做過反控**：真的去打一條不存在的路由，把回來的 403 餵進 `want_forbidden`
⇒ 判**失敗**；把真的擁有權 403 餵進去 ⇒ 判**通過**（2 格 1 紅）。
🔴 **而那一輪多炸出一件事**：gateway 回的是
`Invalid key=value pair (missing equal-sign) in Authorization header`，
**不是** `Missing Authentication Token` ⇒ **gateway 的 403 措辭不只一種**。
救我的不是 `SIGV4_MSG` 那份黑名單（黑名單＝手挑清單，漏掉的靜靜通過），
是「**必須出現「只有主揪」**」這個**正向要求** —— 不管 gateway 怎麼措辭，
它都不會說出那四個字。程式註解已改成點明這件事。

**寫入面積與清理**：Users 2／Games 1／Registrations 1／Notifications 2，
每一筆 `delete` 後 `GetItem --consistent-read` 確認不存在。
⚠️ Notifications 的 key 是 `notificationId` ⇒ 要 **Scan ＋ `userId` 過濾**才找得到本次那幾筆。
⚠️ **不走 `/app-register` 建帳號**：那支限流是每 IP 每小時 10 次，而本支要兩個帳號
⇒ 走它的話一小時只能跑 5 次。改成直接放兩列合成身分＋自簽 token。

🔴 **殘留掃描那一輪有三格是空洞的通過**：`Games`／`Registrations`／`Notifications`
在 stg **本來就是空表**（全表計數 0）⇒ 任何過濾都回 0，對「有沒有殘留」零鑑別力。
有鑑別力的只有 `Users`（全表 6 列、我的 MARK 過濾回 0）。
那三張表真正的證據是探針自己的**逐筆 delete → GetItem 確認不存在**。
⇒ 引用「殘留 0」時要分開講這兩種。

⚠️ **順帶記一個沒處理的形狀**：`game["hostUserId"].(string)` 與 `registration["status"].(string)`
都是**裸型別斷言** —— 欄位缺席或非字串會 panic ⇒ Lambda Unhandled ⇒ **502**。
那不是授權繞過（是 fail-crash 不是 fail-open），但正是設計冊 P0 記過的那種形狀。**本輪未修。**

### 🛠️ 裸型別斷言修掉了 —— 而「那兩處」實際是 10 處（2026-09-11）

上一節結尾標的那兩處（`game["hostUserId"].(string)`／`registration["status"].(string)`）
是**我剛好讀到的兩處**。用 Go AST 掃一遍，光那兩支 handler 的生產碼就有 **9 處**，
再加上第三支 `web_cancel_game` 的**同一個表達式、同一個用途**，共 **10 處**。

🔴 **用 `go/ast` 不是 grep**：這是「哪些運算式是型別斷言」的問題，parser 才答得準。
grep 寫得出來的只是一份手挑清單（`.(string)` `.(float64)` …），漏掉的那種零徵兆。
✅ **掃描器先校準過**：拿一個已知答案的假件（1 裸 ＋ 巢狀 2 裸 ＋ `v, ok :=` ＋ `switch .(type)`）
餵它，恰好抓到 3 處、安全形式零誤報。

**處置不是一律相同 —— 判準是「缺席時怎樣才是 fail-closed」**：

| 處 | 處置 | 為什麼 |
|---|---|---|
| `game["hostUserId"]`（×3 支） | **500 資料異常** | 退成 `""` 會讓 `"" != userID` 恆真 ⇒ 一律 403，那是「用錯誤的理由拒絕」，日誌上分不出是誰的問題 |
| `registration["status"]` | **500** | 退成 `""` 既不是 `accepted` 也不是 `rejected` ⇒ **會被放行**，那是 fail-**open** |
| `game["currentPlayers"/"playersNeeded"]` | **500** | 退成 0 會讓「滿團」判斷靜靜出錯 |
| `registration["userId"]`（accept） | **500** | 加不進玩家就不該宣稱成功 |
| `registration["displayName"]` | **退成 `""`** | 缺席是良性的（只是顯示名），不該擋整個請求 |
| `registration["userId"]`（reject 的通知） | **跳過通知，請求仍算成功** | 🔴 那一處在**拒絕已經寫進資料庫之後**。回 500/502 會讓客戶端以為失敗而重試，**而資料其實已經改了** —— 比少一則通知糟得多 |

**棘輪**（`backend/cmd/lambdas/bareassert/`）：修完之後全 repo 生產碼仍有 9 處
（多在 admin 那幾支，一次修完划不來），收進 `baseline.txt`，**新增一處就紅**。
- **key 是「相對路徑 ＋ 斷言原文」不是行號** —— 行號會被上面任何一行編輯位移，
  而假紅會訓練出「直接 `-update`」的習慣，那會把真正的新增一起吞掉。
- ⚠️ **已知代價**：同一檔裡原文相同的兩處會塌成一筆
  （`admin_push_all` 的 `token.Claims.(jwt.MapClaims)`：AST 掃到 3 處、baseline 只有 2 筆）
  ⇒ 修掉三處中的一處不會被看見。代價不對稱所以接受。
- **移除也要紅**：否則 baseline 靜靜過期，而過期的 baseline 會把未來的新增當成既有的放過去。

**驗收**：

| 尺 | 讀數 |
|---|---|
| AST 重掃那三支 | 裸斷言 **0 處**（原 6＋3＋1） |
| `gofmt -l` | 乾淨 ⚠️ 中途一度不乾淨，**而 HEAD 版本是乾淨的 ⇒ 是我造成的**（gofmt 1.19+ 把 doc comment 裡縮排的續行當程式碼區塊重排）。已把續行改成不縮排 |
| `go build ./...`／`go vet ./...`／`go test ./...` | 全 **rc=0** |
| `TestRatchetHasTeeth`（掃描器正控） | 通過 —— 少了它，`scan()` 若永遠回空集合，棘輪會**恆綠**，而「一處都沒新增」與「掃描器瞎了」逐字相同 |
| **突變 ①** 生產碼新增一處裸斷言 | 棘輪**紅**，rc=1 |
| **突變 ②** baseline 刪掉一筆 | 紅（走「新增」那條分支） |
| **突變 ③** baseline 多一筆程式裡沒有的 | 紅（走**「已經修掉了」**那條分支） |

⚠️ 突變②③是分開做的：②打的是「新增」分支，而「baseline 過期」那條分支**它照不到**
—— 兩條分支要各自求值過，否則其中一條等於沒寫。

⚠️ **順手收掉一份重複**：過程中寫的 `infra/astscan`（獨立 CLI）與棘輪測試是**同一套邏輯的兩份**，
已刪掉 CLI，只留有 exit code、會被 `go test ./...` 帶到的那一份。

~~🔴 **界線：這一輪只驗到「不會再新增」與「編譯測試都過」，沒有驗行為。**~~
（上一輪的界線，已於同日補完 —— 見下。）

#### ✅ 行為驗收：502 → 500，而 before 是**部署前**量的（2026-09-11）

新增 `infra/verify_bare_assert_live.py`（4 格）。

🔴 **只跑部署後那一次證明不了任何事**：「500」跟「本來就回 500」逐字相同。
判準是**兩次讀數的差**，所以 before 在部署**之前**先量。

情境是**造一筆缺欄位的紀錄**（直接寫 DDB），不是等它自然發生：

| | 造什麼 | before（線上 `52c9779`） | after（`a427548`） |
|---|---|---|---|
| A | `Games` 那列**沒有 `hostUserId`** | **502** `{"message": "Internal server error"}` | **500** `{"error":"資料異常，請稍後再試"}` |
| B | `Registrations` 那列**沒有 `status`** | **502** | **500** |
| A2 | 同一個洞在 `reject` 上 | **502** | **500** |
| **C（正控）** | 兩列都正常、而我**不是**主揪 | **403** `只有主揪可以接受報名` | **403（未變）** |

🔴 **C 撐著 A/B**：少了它，「A/B 壞掉」與「這個端點對任何輸入都 5xx」分不出來。
🔴 **body 形狀一併斷言**：502 是 **gateway** 的 `{"message":"Internal server error"}`、
500 是 **handler 自己** 的 `{"success":false,"error":"資料異常…"}`。
只比狀態碼的話，「handler 主動回 500」與「某層代我回了 500」分不出來。
✅ **反向反控**：部署後再拿 `EXPECT=502` 跑一次 ⇒ **1/4**（只有 C 過），rc=1。

**產物驗證中途換過一把尺**：第一版用 `strings | grep 資料異常` ⇒ 三支**全是 0**。
那不是「沒進去」，是 **`strings` 預設只吐 ASCII**，中文 UTF-8 位元組它不輸出。
而 `cancel_game` 是行內處理、沒有 `dataErr` 函式 ⇒ 我對它**一個正向訊號都沒有**。
改用 `grep -a` 直接找位元組，並配兩道控制：
①沒動過的 `daily_bonus` = **0**；
②從 `52c9779` **現建一份舊版** `cancel_game` ⇒ `資料異常`=**0** 而 `只有主揪`=**1**
⇒ 尺讀得到這個載體，而差異是這次改動造成的。

**部署本身**：工作樹 0 已修改（唯一 1 個未追蹤檔是 `infra/verify_bare_assert_live.py`，
在 `infra/` 不在 `backend/` ⇒ `build_all.sh` 讀不到它）；
stale **只有我改的那 3 顆**（上次那種「順帶把別人的改動推上線」這次沒有發生）；
`build_all.sh` **ok=84 fail=0**；`sam deploy` **rc=0**。

**迴歸**（部署動了全部 84 顆）：`verify_daily_bonus_live.py` **11/11**／
`verify_migrated_routes_live.py` **14/14**／`verify_auth_inhandler_gate.py` **24/24**／
`verify_registration_authz_live.py` **7/7**／`security_regression.sh` **36/36**，全 rc=0。

~~⚠️ **仍未驗**：`displayName` 缺席時退成 `""` 那條、以及 reject 通知那條~~
（已於同日補完 —— 見下。剩下 9 處 baseline 裡的裸斷言仍未修。）

#### ✅ 兩條**刻意降級**的路徑也驗了（2026-09-11，`verify_degrade_paths_live.py`）

🔴 **這兩條難在它們要證明的是「某件事沒有發生」** —— 少一個顯示名、少一則通知，
而「刻意跳過」與「這個功能根本壞了」在讀數上**逐字相同**（兩邊都是「沒有」）。
⇒ 每一條都配一個「**有資料時它會發生**」的對照，成對才有鑑別力。

| | 情境 | 請求 | 落地 |
|---|---|---|---|
| **D1** | `Registrations` 缺 `displayName` | accept → **200** | `Games.joinedPlayers[0].displayName` == **`''`** |
| **D2**（對照） | 同上但**有** `displayName` | accept → **200** | == 我放進去的值 |
| **D 承重** | 兩者**不同** | | ⇒ D1 是降級，不是「這欄位永遠寫不進去」 |
| **E1** | `Registrations` 缺 `userId` | reject → **200** | 該 `gameId` 的通知 **0 則** |
| **E2**（對照） | 同上但**有** `userId` | reject → **200** | 該 `gameId` 的通知 **1 則** |
| **E 承重** | 兩者**不同**（0 vs 1） | | ⇒ E1 是跳過，不是「通知從來就發不出去」 |

**10/10**，rc=0。清理：Users 2／Games 4／Registrations 4／Notifications **3**
（D1、D2 各 1 ＋ E2 的 1，E1 本來就 0 —— 數字與 E 的斷言互相對得起來）。

🔴 **E 那條為什麼刻意降級**：它在**拒絕已經寫進資料庫之後**。若在那裡回 5xx，
客戶端會以為失敗而重試，**而資料其實已經改了** —— 比少一則通知糟得多。

### 🔴 搬 §5 不是重構，是修東西：App 結構上打不到任何 HTTP_V2 路由（2026-09-11 量到）

做上面那個前置時順手量到的，不在計畫內。

`ryojaku-api.boyplaymj.com` 這個自訂網域的 mapping 指的是 **`9mu0vajn38`＝RestApi**，
而 **HttpApi（`3pmmlmvr5a`）沒有任何自訂網域 mapping**（`apigatewayv2 get-api-mappings`
兩個網域各一筆，都指 REST／WS）。而前端只有**一個** base：
`apiService.ts` 全部端點走同一個 `API_BASE_URL`，`deploy-stg.sh:26` 把它設成那個自訂網域。

**出貨 bundle 實測**（`frontend/android/.../index-CAjpxzs7.js`）：
`ryojaku-api.boyplaymj.com` 出現 1 次、`3pmmlmvr5a` 出現 **0 次**、`9mu0vajn38` **0 次**。

**不帶 token 打同一條路徑，兩個 base 的回應不同**（403＝REST 的「查無此路由」、
401＝路由在但被 authorizer 擋）：

| 路徑 | 自訂網域（App 用的） | HttpApi 直連 |
|---|---|---|
| `POST /claim-push-bonus` | **403 Missing Authentication Token** | 401 Unauthorized |
| `POST /registrations/accept` | **403** | 401 |
| `POST /registrations/reject` | **403** | 401 |
| `GET /ratings` | **403** | 400（業務錯誤「必須提供 gameId」⇒ 路由在且不需認證） |
| `GET /notifications` | **403** | 401 |
| `GET /chat/rooms`（正控·REST 上的） | 401 | 404 |

🔴 **最後一列是正控**：少了它，「403 代表打不到」與「這個 base 整個壞了」分不出來。

⇒ `/notifications`、`/claim-push-bonus` 這些**在 App 裡是有被呼叫的**
（`apiService.ts:325,525,928`），而它們打過去只會拿到 403。
**搬 §5 的效果不只是收斂 API，是把這幾條接回來。**

⚠️ **界線**：本輪量的是 **stg**。沒有查 prod 是不是同一個形狀，也沒有查
這是一直如此、還是某次改 mapping 造成的（沒有歷史資料可判）。
也沒有查 App 端拿到 403 之後的行為（`/notifications` 有 localhost 用的 mock fallback，
其他幾條沒看）。

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

#### ✅ ① 已完成（2026-09-11）—— 而那個「尚未驗證」現在**不必賭了**

`gen_app_template.py` 的 `HttpApi` 整段抽成 `HTTP_API_RESOURCE` 常數，由
`_has_http = any(apiType == "HTTP_V2")` 決定要不要放進去；`Outputs.HttpApiUrl`
跟著條件化。（`AuthorizerHttpApiPermission` **本來就已經是條件式的** ——
它由 `_http_authorizers` 驅動，而那份名單本來就只收 HTTP_V2 的，本次未動。
⚠️ 上面那段把它列成待辦，那是**當時盤點錯了**，留著當紀錄。）

**fail-closed 自檢**（比照既有那道 WS 的）：產出裡「有沒有 `!Ref HttpApi`／`${HttpApi}`」
與「有沒有 `Type: AWS::Serverless::HttpApi`」必須同時成立，任一方向不符就
`raise SystemExit`。兩個方向的理由不同 ——
①有引用沒資源 ⇒ deploy 才炸，在產生器這裡是靜悄悄的；
②有資源沒引用 ⇒ 那正是本段要避開的賭注。
🔴 判準只認**引用形式**，不認裸字串 `HttpApi`：`Type: AWS::Serverless::HttpApi`
與事件的 `Type: HttpApi` 都含那幾個字，用裸字串比對的話這道檢查對任何輸入都成立。

**驗收**：

| 尺 | 讀數 |
|---|---|
| **迴歸**·現行 manifest（仍有 HTTP_V2）產出 | **逐位元組不變**（`26bbd8c6…`，2896 行） |
| 正控·把 manifest 的 5 支 HTTP_V2 全改 REST_V1（＝§5 終局） | `Type: AWS::Serverless::HttpApi`／`!Ref HttpApi`／`${HttpApi}`／`HttpApiUrl`／`AuthorizerHttpApiPermission` **五樣全部 0**（基線是 1／5／2／1／1）；REST 路由 75→80 |
| cfn-lint（`regions=[ap-southeast-1]`） | 兩份都 **0 則** |
| **反控**·把基線的 `HttpApi` 資源刪掉（留 7 處懸空引用） | cfn-lint **5 則 E0001** ⇒ 這把尺抓得到，上面那兩個 0 才有意義 |
| **突變**·拔掉條件化（永不輸出／永遠輸出） | **2 發全擋**，且兩個未突變的正控都放行 |

🔴 **cfn-lint 的區域預設值會騙人。** 沒收斂區域時，**基線那份**（已部署、正常運作）
就有 **37 則 E**，全是「這個型別在 `ap-east-2`／`ap-southeast-6` 不存在」。
只跑受測那份會看到 33 則而誤判 —— 校準（先量一次已知是好的那份）是這裡唯一的出路。

**順帶回答了本段那個掛著的問題，但只答到一半**：把一個 route-less 的
`HttpApi` 硬塞回去，**SAM transform 過得了**（cfn-lint 0 則），
transform 產物是 `AWS::ApiGatewayV2::Api` 且 `Body.paths = {}`。
⚠️ **「APIGW 的 ImportApi 收不收空 paths」仍然沒驗** —— 那要真的 deploy 才知道。
本次的改法讓這題變成不必答。

## 6. 本次對帳沒能證明的事

- **方法別**：manifest 大量用 `ANY`，前端 85 條呼叫 0 條不符，但這多半是 `ANY` 太寬鬆而非真的對齊。
  上游 `ledger` 是 `GET/POST/PUT/DELETE /ledger` 但只有 `GET /ledger/summary`；
  我方 `ANY` + 兩條 path 會讓 `POST /ledger/summary` 也進得了 Lambda（上游會 404）。是超集，不是破壞。
- **請求/回應 body 形狀**：完全未對帳。路徑通了不代表欄位名對得上。
- **`auth` 欄位**：72 顆的 `public`/`user`/`admin` 分類未逐顆驗證，只在 `analytics` 這顆偶然發現異常。

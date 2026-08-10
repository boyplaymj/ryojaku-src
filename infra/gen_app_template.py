#!/usr/bin/env python3
"""
讀 functions.manifest.json → 產出 02-app.generated.yaml (AWS SAM 計算層)。
一 Lambda 一 function；REST_V1→RestApi、HTTP_V2→HttpApi、WEBSOCKET→WS API、
STREAM→DynamoDB 事件、LAMBDA_URL→FunctionUrl。機密走 SSM，DDB IAM 對 ${prefix}* 全域。
用法: python3 gen_app_template.py  (輸出到同目錄 02-app.generated.yaml)
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
MAN = json.load(open(os.path.join(HERE, "functions.manifest.json")))["functions"]

def logical(name):  # kebab → PascalCase LogicalId
    return "Fn" + "".join(p.capitalize() for p in re.split(r"[-_]", name))

# ---------------------------------------------------------------------------
# S1：Lambda Authorizer 掛載範圍。
#
# 🔴 auth 欄位「部分接線」，別當它全是註解（原註解寫「一直只是註解」是錯的，已訂正）：
#   auth: "admin"  → 已接線。authorizer_for() 讀它，14 顆 admin 端點自動掛
#                    RyojakuAdminAuth。改這個值會真的改變產出，不是文件。
#   auth: "user"   → 尚未接線。閘門仍由下面的 AUTHORIZER_PILOT 手工列舉決定。
#   auth: "public" → 尚未接線（同上，只是還沒被列舉到而已，不是有人擋著）。
#   tables         → 真·裝飾。產生器零讀取，IAM 一律發全域 DDB_POLICY。
#
# S1 起點是「CFN 模板裡 authorizer 數為 0，35 個標 auth:user 的端點只有 5 個在程式內
# 自驗 JWT，其餘不帶 token 即可冒充任意用戶」（見 tools/ryojaku-webapp/SECURITY_AUTH_BYPASS.md）。
# 那是**歷史起點**，不是現況。
#
# S1 先以「明確列舉」的方式試點，只掛少數唯讀端點，驗證機制在 REST_V1 與 HTTP_V2
# 兩種 apiType 上都成立、且前端不會斷。
# S2 才把這裡改成 `f["auth"] == "user"` 全面套用 —— 屆時務必確認 auth:public 端點
# 不會被誤掛（register / login / forgot 被掛上去會直接鎖死註冊流程）。
USER_AUTHORIZER_NAME = "RyojakuUserAuth"
ADMIN_AUTHORIZER_NAME = "RyojakuAdminAuth"
USER_AUTHORIZER_FUNCTION = "authorizer"
ADMIN_AUTHORIZER_FUNCTION = "admin-authorizer"
AUTHORIZER_PILOT = {
    # S1 pilot：REST_V1 / HTTP_V2 authorizer 機制驗證。
    "ledger",        # REST_V1  ANY  /ledger
    "user-profile",  # REST_V1  ANY  /user-profile
    "my-games",      # REST_V1  POST /my-games
    "notifications", # HTTP_V2  ANY  /notifications

    # S2-A（風險分級見 SECURITY_AUTH_BYPASS.md §3；原註記為「低風險」有誤，已更正：
    #  daily-bonus 與 claim-push-bonus 是 A 級金流，會直接發點數，不是低風險讀取。）
    "daily-bonus",            # HTTP_V2 POST /daily-bonus         ← A 級金流
    "claim-push-bonus",       # HTTP_V2 POST /claim-push-bonus    ← A 級金流
    "chat-get-history",       # REST_V1 GET  /chat/history        D 級讀取
    "chat-get-room-info",     # REST_V1 GET  /chat/room-info      D 級讀取
    "chat-get-rooms",         # REST_V1 GET  /chat/rooms          D 級讀取
    "subscription-status",    # REST_V1 POST /subscription-status D 級讀取

    # S2-B：B 級「代他人執行破壞性動作」7 支（SECURITY_AUTH_BYPASS.md §3）。
    #  掛閘前實測：7 支不帶 Authorization 全部直接進業務邏輯（回 404「找不到此團局」等
    #  業務錯誤而非 401），亦即任何人都能代他人取消團局／退報名／審核申請。
    #  注意 manifest 名稱與路徑不同名：accept/reject-registration 的路徑是 /registrations/*。
    "cancel-game",            # REST_V1 POST /cancel-game
    "cancel-registration",    # REST_V1 POST /cancel-registration
    "create-game",            # REST_V1 POST /create-game
    "game-register",          # REST_V1 POST /game-register
    "submit-rating",          # REST_V1 POST /submit-rating
    "accept-registration",    # HTTP_V2 POST /registrations/accept
    "reject-registration",    # HTTP_V2 POST /registrations/reject

    # S2-C：C 級「代他人發言／冒名內容」8 支（全 REST_V1 POST）。
    #  掛閘前實測 10 支（含下方 D 級 2 支）不帶 Authorization 全部進業務邏輯，
    #  回 400 欄位驗證錯誤而非 401 —— 身分完全由 request body 的 userId 自稱。
    "community-create-post",    # /community-create-post
    "community-add-comment",    # /community-add-comment
    "community-like-post",      # /community-like-post
    "community-like-comment",   # /community-like-comment
    "community-get-upload-url", # /community-get-upload-url   ← 可代他人取得 S3 上傳授權
    "get-upload-url",           # /get-upload-url             ← 同上
    "chat-get-upload-url",      # /chat/upload-url（名稱與路徑不同名）← 同上
    "chat-mark-read",           # /chat-mark-read

    # S2-D：D 級「讀取他人私有資料」剩餘 2 支。其餘 D 級已於 S1／S2-A／S3 掛完。
    "subscribe-push",         # /subscribe-push    ← 可代他人註冊推播裝置
    "unsubscribe-push",       # /unsubscribe-push  ← 可代他人退掉推播

    # S4（2026-07-31）：四支 upload 端點裡唯一的漏網者。
    # 它 manifest 標 auth:"public"、又不在本名單 → **兩層都沒人管到它**。
    # staging 實打：不帶任何憑證 POST 回 200 拿到預簽網址，PUT 回 200，
    # 物件確實落進 ryojaku-stg-community。（另三支 upload 端點早在本名單內，故未認證會被擋。）
    #
    # 🔴 教訓：本名單是「明確列舉」，漏列**不會產生任何錯誤訊號** ——
    # 掃蕩的涵蓋範圍等於這份名單，名單漏了，稽核也會跟著漏。新增 user 端點必須同步加入，
    # 直到 S2 改成依 manifest 的 auth 欄位自動套用為止。
    "event-get-upload-url",   # /event-get-upload-url  ← 未認證可寫入 S3

    # LINE Login（新增 user 端點 → 依上面那條教訓同步列舉）。
    # 這支自己也會 fail-closed（shared.GetUserIdentifierWithContext 必須 fromJWT），
    # 掛 authorizer 是第二層：未帶 token 在 gateway 就被擋掉，不進 lambda。
    "auth-bind-line",         # REST_V1 POST /auth/bind-line
    # ⚠️ 尚未列舉的同族 user 端點：auth-bind-google / auth-unbind / auth-change-password /
    #    auth-logout-all。四支都在程式內自驗 JWT（fromJWT 必須為 true）故非漏洞，
    #    但缺第二層；要不要一起補屬另案，別在這裡順手改而沒實測。
}

def authorizer_for(f):
    if f["name"] in AUTHORIZER_PILOT:
        return USER_AUTHORIZER_NAME
    if f.get("auth") == "admin" and f.get("apiType") in ("REST_V1", "HTTP_V2"):
        return ADMIN_AUTHORIZER_NAME
    return None

def needs_authorizer(f):
    return authorizer_for(f) is not None

def authorizer_lid(name):
    if name == USER_AUTHORIZER_NAME:
        return logical(USER_AUTHORIZER_FUNCTION)
    if name == ADMIN_AUTHORIZER_NAME:
        return logical(ADMIN_AUTHORIZER_FUNCTION)
    raise ValueError(f"unknown authorizer: {name}")

# Identity.ReauthorizeEvery = 0 → 關閉 authorizer 結果快取。
# 必須關：快取會讓「改密碼／登出全裝置」後的撤銷延後到 TTL 到期才生效，
# 直接抵銷 shared.VerifyTokenWithUserPwGate 那道閘的意義。
# 若日後為了成本要開，必須明確記錄 TTL＝撤銷生效的最壞延遲。
# 注意縮排：Auth 是 Properties 底下的屬性（6 空格），不是與 Properties 同級（4 空格）。
def auth_block_rest(names):
    if not names:
        return ""
    lines = ["      Auth:", "        Authorizers:"]
    for name in names:
        lines += [f"          {name}:",
                  f"            FunctionArn: !GetAtt {authorizer_lid(name)}.Arn",
                  "            FunctionPayloadType: REQUEST",
                  "            Identity:",
                  "              Headers: [Authorization]",
                  "              ReauthorizeEvery: 0"]
    return "\n".join(lines)

def auth_block_http(names):
    if not names:
        return ""
    lines = ["      Auth:", "        Authorizers:"]
    for name in names:
        lines += [f"          {name}:",
                  f"            FunctionArn: !GetAtt {authorizer_lid(name)}.Arn",
                  "            AuthorizerPayloadFormatVersion: 1.0",
                  "            EnableSimpleResponses: false",
                  "            Identity:",
                  "              Headers: [Authorization]",
                  "              ReauthorizeEvery: 0"]
    return "\n".join(lines)

HEAD = """AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: >
  両雀 Ryōjaku — 計算層 (61 Lambda + REST/HTTP/WebSocket API)。
  由 gen_app_template.py 從 functions.manifest.json 生成，勿手改此檔。
  機密由 SSM 注入；DynamoDB 表由 01-tables.yaml 先建。

Parameters:
  TablePrefix: { Type: String, Default: MahjongClubStg_ }
  # LineBot-* 表(AI顧問/LINE 用戶檔)的前綴。staging=LineBotStg- 與 prod(LineBot-)分離,
  # 避免同帳號 stg/prod 撞名(internal/services 讀 LINEBOT_TABLE_PREFIX)。正式切換改回 LineBot-。
  LineBotTablePrefix: { Type: String, Default: LineBotStg- }
  Stage: { Type: String, Default: stg }
  # 機密以 NoEcho 參數注入（值於部署時由 deploy_app.sh 從 SSM SecureString 解密後
  # 帶入 --parameter-overrides；CFN 不允許 ssm-secure 動態引用用在 Lambda 環境變數）。
  EncryptionKey: { Type: String, NoEcho: true }
  JwtSecret: { Type: String, NoEcho: true }
  # D5：admin token 專用簽章金鑰。與 JwtSecret 分離後，user token 在**密碼學上**就不可能
  # 被當成 admin token —— 在此之前兩者共用同一把，只靠 role claim 區分。
  AdminJwtSecret: { Type: String, NoEcho: true }
  VapidPublicKey: { Type: String, NoEcho: true }
  VapidPrivateKey: { Type: String, NoEcho: true }
  VapidSubscriber: { Type: String, NoEcho: true }
  # 帳號系統 P6：非機密設定（明碼參數）。GOOGLE_CLIENT_ID 是公開值(前端亦內嵌)；SES 寄件設定。
  GoogleClientId: { Type: String, Default: '' }
  # LINE Login channel ID（公開值，前端亦內嵌；**不是** LINE bot 的 channel）。
  # 空字串 → shared.VerifyLINEIDToken 直接回 ErrLineChannelNotConfigured，
  # LINE 登入端點一律 401（fail-closed，不會因為沒設就放行）。
  LineLoginChannelId: { Type: String, Default: '' }
  MailFrom: { Type: String, Default: '両雀 Ryojaku <no-reply@jiomj.com>' }
  AppBaseUrl: { Type: String, Default: 'https://jiomj.boyplaymj.com' }
  SesRegion: { Type: String, Default: 'ap-southeast-1' }
  EmailVerifyGate: { Type: String, Default: 'on' }

Globals:
  Function:
    Runtime: provided.al2023
    Architectures: [arm64]
    Handler: bootstrap
    MemorySize: 256
    Timeout: 30
    Environment:
      Variables:
        ENVIRONMENT: !Ref Stage
        TABLE_PREFIX: !Ref TablePrefix
        LINEBOT_TABLE_PREFIX: !Ref LineBotTablePrefix
        # S2補:上傳端點讀這兩個env指向我們的桶(原fallback寫死prod桶mahjongclub-*)
        ASSETS_BUCKET: !Sub 'ryojaku-${Stage}-assets'
        COMMUNITY_BUCKET: !Sub 'ryojaku-${Stage}-community'
        ENCRYPTION_KEY: !Ref EncryptionKey
        JWT_SECRET: !Ref JwtSecret
        ADMIN_JWT_SECRET: !Ref AdminJwtSecret
        VAPID_PUBLIC_KEY: !Ref VapidPublicKey
        VAPID_PRIVATE_KEY: !Ref VapidPrivateKey
        VAPID_SUBSCRIBER: !Ref VapidSubscriber
        GOOGLE_CLIENT_ID: !Ref GoogleClientId
        LINE_LOGIN_CHANNEL_ID: !Ref LineLoginChannelId
        MAIL_FROM: !Ref MailFrom
        APP_BASE_URL: !Ref AppBaseUrl
        SES_REGION: !Ref SesRegion
        EMAIL_VERIFY_GATE: !Ref EmailVerifyGate

Resources:

  RestApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: !Ref Stage
      # ⚠️ 不可退回字串簡寫 Cors: "'*'" —— 那只設 AllowOrigin，不設 AllowHeaders，
      # preflight 回應就不會有 Access-Control-Allow-Headers，瀏覽器會擋掉每一個帶
      # Content-Type: application/json 或 Authorization 的請求（等於整個前端不能用）。
      # curl 不執行 CORS，所以這個洞不會被任何 curl 煙霧測試抓到，只有真瀏覽器會爆。
      # AllowHeaders 必須涵蓋前端 apiRequest 實際送出的四個 header。
      Cors:
        AllowOrigin: "'*'"
        AllowHeaders: "'Content-Type,Authorization,X-App-Version,X-Platform'"
        AllowMethods: "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
      # P5（§5.7 根因③）：上面的 Cors 只管「正常回應與 preflight」，**管不到 API Gateway 自己
      # 產生的錯誤回應**。authorizer 拒絕時回的 401 由 gateway 直接吐出、不經過任何 lambda，
      # 因此沒有 CORS 標頭 —— 瀏覽器看到的是 CORS 失敗而不是 401。
      #
      # 後果不只是難看：admin_frontend 的 api.ts 靠 `res.status === 401` 清 token 跳登入頁，
      # 而 fetch 在 CORS 層就 reject、根本拿不到 status，**session 過期時 Console 不會跳登入頁，
      # 只會卡在看不懂的網路錯誤**。
      #
      # ⚠️ 用 SAM 的 GatewayResponses 屬性，不要另外寫 AWS::ApiGateway::GatewayResponse 資源 ——
      # 後者會被 cfn-lint W3660 擋下（與 SAM 產生的 API Body 分屬兩處定義，可能漂移／留孤兒）。
      # 一樣是 curl 驗不出來的一類（curl 不執行 CORS），驗收要用真瀏覽器。
      GatewayResponses:
        UNAUTHORIZED:
          ResponseParameters:
            Headers:
              Access-Control-Allow-Origin: "'*'"
              Access-Control-Allow-Headers: "'Content-Type,Authorization,X-App-Version,X-Platform'"
              Access-Control-Allow-Methods: "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
        ACCESS_DENIED:
          ResponseParameters:
            Headers:
              Access-Control-Allow-Origin: "'*'"
              Access-Control-Allow-Headers: "'Content-Type,Authorization,X-App-Version,X-Platform'"
              Access-Control-Allow-Methods: "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
        DEFAULT_4XX:
          ResponseParameters:
            Headers:
              Access-Control-Allow-Origin: "'*'"
              Access-Control-Allow-Headers: "'Content-Type,Authorization,X-App-Version,X-Platform'"
              Access-Control-Allow-Methods: "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
        DEFAULT_5XX:
          ResponseParameters:
            Headers:
              Access-Control-Allow-Origin: "'*'"
              Access-Control-Allow-Headers: "'Content-Type,Authorization,X-App-Version,X-Platform'"
              Access-Control-Allow-Methods: "'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
__REST_AUTH__


  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: !Ref Stage
      # HTTP API 原本完全沒有 CORS 設定（get-api 回 CorsConfiguration: null、
      # preflight 直接 404），故其下所有端點在瀏覽器中一律不可用。
      # 注意與上面 REST 的寫法不同：HTTP API 用純字串列表，不加內層單引號。
      CorsConfiguration:
        AllowOrigins: ["*"]
        AllowHeaders: [Content-Type, Authorization, X-App-Version, X-Platform]
        AllowMethods: [GET, POST, PUT, PATCH, DELETE, OPTIONS]
__HTTP_AUTH__
"""

DDB_POLICY = """      Policies:
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action: [dynamodb:*]
              Resource:
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TablePrefix}*'
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TablePrefix}*/index/*'
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${LineBotTablePrefix}*'
                - !Sub 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${LineBotTablePrefix}*/index/*'
            - Effect: Allow
              Action: [s3:PutObject, s3:GetObject]
              Resource:
                - !Sub 'arn:aws:s3:::ryojaku-${Stage}-assets/*'
                - !Sub 'arn:aws:s3:::ryojaku-${Stage}-community/*'
            - Effect: Allow
              Action: [ses:SendEmail, ses:SendRawEmail]
              Resource: '*'
"""

# SAM 只會替 REST API 的 authorizer 自動建 Lambda invoke 權限，
# HTTP API 的那份不會建 —— 少了它，API Gateway 叫不動 authorizer，
# 帶合法 token 的請求會回 500（而且 authorizer 完全不會被觸發，日誌空白，很難查）。
# S1 試點實測踩到，故在此明確補上。
HTTP_AUTHZ_PERMISSION = """
  # HTTP API 專用：明確授權 API Gateway 呼叫 authorizer（SAM 不會自動建這份）。
  {perm_lid}:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !GetAtt {lid}.Arn
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub 'arn:aws:execute-api:${{AWS::Region}}:${{AWS::AccountId}}:${{HttpApi}}/authorizers/*'
"""

def fn_block(f):
    lid = logical(f["name"])
    # path 允許以逗號列多條（同一支 lambda 掛多個路由）。用於「bare 路徑與子路徑都要」的支：
    # 例如 admin-vouchers 的 GET /admin/vouchers 與 POST /admin/vouchers/{update,delete}
    # —— 只留 {proxy+} 會讓 bare 消失，只留 bare 則子路徑 403。單條時行為與過去完全相同
    # （事件鍵仍是 Rest0/Rest1…，不會讓既有函式的 generated yaml 產生無謂 diff）。
    paths = [p.strip().rstrip("?") for p in f["path"].split(",") if p.strip()]
    # 預編產物：go build 出的 arm64 bootstrap 放在 build/<art>/bootstrap
    # (SAM makefile builder 會把單一 function 葉目錄複製到 scratch，失去 go module
    #  根、解不到跨套件 shared import；故改用預編 zip artifact，build 由 build_all.sh 控。)
    art = f["projectPath"].replace("cmd/lambdas/", "").replace("/", "__")
    b = [f"  {lid}:",
         "    Type: AWS::Serverless::Function",
         "    Properties:",
         f"      CodeUri: ../build/{art}",
         f"      FunctionName: !Sub 'ryojaku-${{Stage}}-{f['name']}'"]
    ev = f["apiType"]
    methods = ["ANY"] if f["method"] == "ANY" else f["method"].split(",")
    # 掛 authorizer 的端點改用區塊式 Properties（inline flow mapping 塞不下巢狀 Auth）。
    authz = authorizer_for(f)
    if ev == "REST_V1":
        b.append("      Events:")
        i = 0
        for path in paths:
            for m in methods:
                b += [f"        Rest{i}:", "          Type: Api"]
                if authz:
                    b += ["          Properties:",
                          "            RestApiId: !Ref RestApi",
                          f"            Path: '{path}'",
                          f"            Method: {m.lower()}",
                          "            Auth:",
                          f"              Authorizer: {authz}"]
                else:
                    b += [f"          Properties: {{ RestApiId: !Ref RestApi, Path: '{path}', Method: {m.lower()} }}"]
                i += 1
    elif ev == "HTTP_V2":
        b.append("      Events:")
        i = 0
        for path in paths:
            for m in methods:
                b += [f"        Http{i}:", "          Type: HttpApi"]
                if authz:
                    b += ["          Properties:",
                          "            ApiId: !Ref HttpApi",
                          f"            Path: '{path}'",
                          f"            Method: {m.upper()}",
                          "            Auth:",
                          f"              Authorizer: {authz}"]
                else:
                    b += [f"          Properties: {{ ApiId: !Ref HttpApi, Path: '{path}', Method: {m.upper()} }}"]
                i += 1
    elif ev == "AUTHORIZER":
        # authorizer 本身不掛任何路由；它被 RestApi / HttpApi 的 Auth 區塊以 GetAtt 引用。
        pass
    elif ev == "LAMBDA_URL":
        b.append("      FunctionUrlConfig: { AuthType: NONE }")
    elif ev == "STREAM":
        # staging: ChatMessages 尚未開 DynamoDB Stream，故先不接觸發器（函式仍部署，
        # 供 S2 開 stream 後再 wire）。見 README TODO。避免引用不存在的 StreamArn。
        pass
    # WEBSOCKET 由下方 WS 區塊統一處理，這裡只出 function 本體
    b.append(DDB_POLICY.rstrip("\n"))
    return "\n".join(b)

def ws_block(ws):
    """WebSocket API + 3 routes ($connect/$disconnect/sendMessage)。

    S3：$connect 掛 REQUEST authorizer。
    WebSocket 只有 $connect 這一個 route 能掛 authorizer，$disconnect / sendMessage
    掛了會被 CFN 拒絕。

    🔴 這只解決**身分驗證**（你是誰），不解決**授權**（你能不能對這個房間做這件事）。
    原註解寫「sendMessage 自動就安全」是把兩者混為一談 —— 由 ConnectionID 反查到的
    userId 確實是真的，但「userId 是真的」不等於「這個 userId 有權操作該 roomId」。
    房間層級的 ACL 只能在各 handler 裡做（shared.IsRoomMember），
    模板這層掛不到、也不該讓讀的人以為掛到了。
    """
    if not ws:
        return ""
    out = ["", "  # ---------- WebSocket API ----------",
           "  WebSocketApi:",
           "    Type: AWS::ApiGatewayV2::Api",
           "    Properties:",
           "      Name: !Sub 'ryojaku-${Stage}-ws'",
           "      ProtocolType: WEBSOCKET",
           "      RouteSelectionExpression: '$request.body.action'",
           # 瀏覽器 WebSocket 無法帶自訂 header，故 identity source 取 query string 的 token。
           "  WsAuthorizer:",
           "    Type: AWS::ApiGatewayV2::Authorizer",
           "    Properties:",
           "      ApiId: !Ref WebSocketApi",
           "      Name: RyojakuWsAuth",
           "      AuthorizerType: REQUEST",
           f"      AuthorizerUri: !Sub 'arn:aws:apigateway:${{AWS::Region}}:lambda:path/2015-03-31/functions/${{{AUTHZ_LID}.Arn}}/invocations'",
           "      IdentitySource: ['route.request.querystring.token']",
           "  WsAuthorizerPermission:",
           "    Type: AWS::Lambda::Permission",
           "    Properties:",
           f"      FunctionName: !GetAtt {AUTHZ_LID}.Arn",
           "      Action: lambda:InvokeFunction",
           "      Principal: apigateway.amazonaws.com",
           "      SourceArn: !Sub 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/authorizers/*'"]
    for f in ws:
        lid = logical(f["name"]); route = f["path"]
        rk = re.sub(r"[^A-Za-z]", "", route) or "Route"
        out += [
           f"  WsInteg{rk}:",
           "    Type: AWS::ApiGatewayV2::Integration",
           "    Properties:",
           "      ApiId: !Ref WebSocketApi",
           "      IntegrationType: AWS_PROXY",
           f"      IntegrationUri: !Sub 'arn:aws:apigateway:${{AWS::Region}}:lambda:path/2015-03-31/functions/${{{lid}.Arn}}/invocations'",
           f"  WsRoute{rk}:",
           "    Type: AWS::ApiGatewayV2::Route",
           "    Properties:",
           "      ApiId: !Ref WebSocketApi",
           f"      RouteKey: '{route}'",
           f"      Target: !Sub 'integrations/${{WsInteg{rk}}}'"]
        # 只有 $connect 能掛 authorizer；$disconnect / sendMessage 掛了會被 CFN 拒絕。
        if route == "$connect":
            out += ["      AuthorizationType: CUSTOM",
                    "      AuthorizerId: !Ref WsAuthorizer"]
        out += [
           f"  WsPerm{rk}:",
           "    Type: AWS::Lambda::Permission",
           "    Properties:",
           f"      FunctionName: !Ref {lid}",
           "      Action: lambda:InvokeFunction",
           "      Principal: apigateway.amazonaws.com"]
    # WebSocket API 一直沒有 Stage/Deployment —— get-stages 與 get-deployments 都回空，
    # 亦即 Outputs 廣告的 wss://.../stg 是個從未存在過的幽靈網址，staging 的 WS 從來沒通過。
    # (REST/HTTP 由 SAM 的 Serverless::Api/HttpApi 自動建 stage，只有這個手刻的 WS 漏了。)
    # AutoDeploy=true 讓路由/authorizer 變更自動重新部署，免去手動 Deployment 的老問題。
    route_lids = ["WsRoute" + (re.sub(r"[^A-Za-z]", "", f["path"]) or "Route") for f in ws]
    out += ["  WsStage:",
            "    Type: AWS::ApiGatewayV2::Stage",
            "    DependsOn: [" + ", ".join(route_lids) + "]",
            "    Properties:",
            "      ApiId: !Ref WebSocketApi",
            "      StageName: !Ref Stage",
            "      AutoDeploy: true"]
    return "\n".join(out)

fns = [f for f in MAN if f["apiType"] != "WEBSOCKET"]
ws = [f for f in MAN if f["apiType"] == "WEBSOCKET"]

# 只有真的有端點掛 authorizer 時才在 API 上宣告 Authorizers，
# 否則產出一個沒人引用的 authorizer 定義（無害但徒增雜訊）。
AUTHZ_LID = logical(USER_AUTHORIZER_FUNCTION)
_rest_authorizers = []
_http_authorizers = []
for _name in (USER_AUTHORIZER_NAME, ADMIN_AUTHORIZER_NAME):
    if any(authorizer_for(f) == _name and f["apiType"] == "REST_V1" for f in MAN):
        _rest_authorizers.append(_name)
    if any(authorizer_for(f) == _name and f["apiType"] == "HTTP_V2" for f in MAN):
        _http_authorizers.append(_name)
head = HEAD.replace("__REST_AUTH__", auth_block_rest(_rest_authorizers))
head = head.replace("__HTTP_AUTH__", auth_block_http(_http_authorizers))

parts = [head]
for f in MAN:  # function 本體(含 WS 的 function)
    parts.append(fn_block(f))
    parts.append("")
parts.append(ws_block(ws))
for _name in _http_authorizers:
    _perm_lid = "AuthorizerHttpApiPermission"
    if _name == ADMIN_AUTHORIZER_NAME:
        _perm_lid = "AdminAuthorizerHttpApiPermission"
    parts.append(HTTP_AUTHZ_PERMISSION.format(
        perm_lid=_perm_lid,
        lid=authorizer_lid(_name),
    ))
parts += ["",
          "Outputs:",
          "  RestApiUrl: { Value: !Sub 'https://${RestApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}' }",
          "  HttpApiUrl: { Value: !Sub 'https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}' }",
          "  WebSocketUrl: { Value: !Sub 'wss://${WebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}' }"]

out = "\n".join(parts) + "\n"
with open(os.path.join(HERE, "02-app.generated.yaml"), "w") as fp:
    fp.write(out)
print(f"generated 02-app.generated.yaml: {len(MAN)} functions "
      f"({len(fns)} api/{len(ws)} ws), {out.count(chr(10))} lines")

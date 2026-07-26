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
# manifest 的 auth 欄位一直只是註解——CFN 模板裡 authorizer 數為 0，34 個標 auth:user
# 的端點只有 5 個在程式內自驗 JWT，其餘不帶 token 即可冒充任意用戶
# （見 tools/ryojaku-webapp/SECURITY_AUTH_BYPASS.md）。
#
# S1 先以「明確列舉」的方式試點，只掛少數唯讀端點，驗證機制在 REST_V1 與 HTTP_V2
# 兩種 apiType 上都成立、且前端不會斷。
# S2 才把這裡改成 `f["auth"] == "user"` 全面套用 —— 屆時務必確認 auth:public 端點
# 不會被誤掛（register / login / forgot 被掛上去會直接鎖死註冊流程）。
AUTHORIZER_NAME = "RyojakuUserAuth"
AUTHORIZER_PILOT = {
    # S1 pilot：REST_V1 / HTTP_V2 authorizer 機制驗證。
    "ledger",        # REST_V1  ANY  /ledger
    "user-profile",  # REST_V1  ANY  /user-profile
    "my-games",      # REST_V1  POST /my-games
    "notifications", # HTTP_V2  ANY  /notifications

    # S2-A：低風險讀取 / 狀態查詢。
    "chat-get-history",       # REST_V1 GET  /chat/history
    "chat-get-room-info",     # REST_V1 GET  /chat/room-info
    "chat-get-rooms",         # REST_V1 GET  /chat/rooms
    "subscription-status",    # REST_V1 POST /subscription-status
    "daily-bonus",            # HTTP_V2 POST /daily-bonus
    "claim-push-bonus",       # HTTP_V2 POST /claim-push-bonus
}

def needs_authorizer(f):
    return f["name"] in AUTHORIZER_PILOT

# Identity.ReauthorizeEvery = 0 → 關閉 authorizer 結果快取。
# 必須關：快取會讓「改密碼／登出全裝置」後的撤銷延後到 TTL 到期才生效，
# 直接抵銷 shared.VerifyTokenWithUserPwGate 那道閘的意義。
# 若日後為了成本要開，必須明確記錄 TTL＝撤銷生效的最壞延遲。
# 注意縮排：Auth 是 Properties 底下的屬性（6 空格），不是與 Properties 同級（4 空格）。
AUTH_BLOCK_REST = f"""      Auth:
        Authorizers:
          {AUTHORIZER_NAME}:
            FunctionArn: !GetAtt {{lid}}.Arn
            FunctionPayloadType: REQUEST
            Identity:
              Headers: [Authorization]
              ReauthorizeEvery: 0
"""

AUTH_BLOCK_HTTP = f"""      Auth:
        Authorizers:
          {AUTHORIZER_NAME}:
            FunctionArn: !GetAtt {{lid}}.Arn
            AuthorizerPayloadFormatVersion: 1.0
            EnableSimpleResponses: false
            Identity:
              Headers: [Authorization]
              ReauthorizeEvery: 0
"""

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
  VapidPublicKey: { Type: String, NoEcho: true }
  VapidPrivateKey: { Type: String, NoEcho: true }
  VapidSubscriber: { Type: String, NoEcho: true }
  # 帳號系統 P6：非機密設定（明碼參數）。GOOGLE_CLIENT_ID 是公開值(前端亦內嵌)；SES 寄件設定。
  GoogleClientId: { Type: String, Default: '' }
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
        VAPID_PUBLIC_KEY: !Ref VapidPublicKey
        VAPID_PRIVATE_KEY: !Ref VapidPrivateKey
        VAPID_SUBSCRIBER: !Ref VapidSubscriber
        GOOGLE_CLIENT_ID: !Ref GoogleClientId
        MAIL_FROM: !Ref MailFrom
        APP_BASE_URL: !Ref AppBaseUrl
        SES_REGION: !Ref SesRegion
        EMAIL_VERIFY_GATE: !Ref EmailVerifyGate

Resources:

  RestApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: !Ref Stage
      Cors: "'*'"
__REST_AUTH__

  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: !Ref Stage
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
  AuthorizerHttpApiPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !GetAtt {lid}.Arn
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub 'arn:aws:execute-api:${{AWS::Region}}:${{AWS::AccountId}}:${{HttpApi}}/authorizers/*'
"""

def fn_block(f):
    lid = logical(f["name"])
    path = f["path"].rstrip("?")
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
    authz = needs_authorizer(f)
    if ev == "REST_V1":
        b.append("      Events:")
        for i, m in enumerate(methods):
            b += [f"        Rest{i}:", "          Type: Api"]
            if authz:
                b += ["          Properties:",
                      "            RestApiId: !Ref RestApi",
                      f"            Path: '{path}'",
                      f"            Method: {m.lower()}",
                      "            Auth:",
                      f"              Authorizer: {AUTHORIZER_NAME}"]
            else:
                b += [f"          Properties: {{ RestApiId: !Ref RestApi, Path: '{path}', Method: {m.lower()} }}"]
    elif ev == "HTTP_V2":
        b.append("      Events:")
        for i, m in enumerate(methods):
            b += [f"        Http{i}:", "          Type: HttpApi"]
            if authz:
                b += ["          Properties:",
                      "            ApiId: !Ref HttpApi",
                      f"            Path: '{path}'",
                      f"            Method: {m.upper()}",
                      "            Auth:",
                      f"              Authorizer: {AUTHORIZER_NAME}"]
            else:
                b += [f"          Properties: {{ ApiId: !Ref HttpApi, Path: '{path}', Method: {m.upper()} }}"]
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
    WebSocket 只有 $connect 這一個 route 能掛 authorizer —— 但這樣就夠了，因為
    sendMessage 不從訊息內容取身分，而是用 ConnectionID 反查 ChatConnections
    (getUserIDByConnection)。只要 $connect 寫進連線表的是「已驗證的 userId」，
    sendMessage 自動就安全，不必也不能另外掛閘。
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
AUTHZ_LID = logical("authorizer")
_rest_authz = any(needs_authorizer(f) and f["apiType"] == "REST_V1" for f in MAN)
_http_authz = any(needs_authorizer(f) and f["apiType"] == "HTTP_V2" for f in MAN)
head = HEAD.replace("__REST_AUTH__",
                    AUTH_BLOCK_REST.format(lid=AUTHZ_LID).rstrip("\n") if _rest_authz else "")
head = head.replace("__HTTP_AUTH__",
                    AUTH_BLOCK_HTTP.format(lid=AUTHZ_LID).rstrip("\n") if _http_authz else "")

parts = [head]
for f in MAN:  # function 本體(含 WS 的 function)
    parts.append(fn_block(f))
    parts.append("")
parts.append(ws_block(ws))
if _http_authz:
    parts.append(HTTP_AUTHZ_PERMISSION.format(lid=AUTHZ_LID))
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

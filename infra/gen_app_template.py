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

Resources:

  RestApi:
    Type: AWS::Serverless::Api
    Properties: { StageName: !Ref Stage, Cors: "'*'" }

  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties: { StageName: !Ref Stage }
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
    if ev == "REST_V1":
        b.append("      Events:")
        for i, m in enumerate(methods):
            b += [f"        Rest{i}:",
                  "          Type: Api",
                  f"          Properties: {{ RestApiId: !Ref RestApi, Path: '{path}', Method: {m.lower()} }}"]
    elif ev == "HTTP_V2":
        b.append("      Events:")
        for i, m in enumerate(methods):
            b += [f"        Http{i}:",
                  "          Type: HttpApi",
                  f"          Properties: {{ ApiId: !Ref HttpApi, Path: '{path}', Method: {m.upper()} }}"]
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
    """WebSocket API + 3 routes ($connect/$disconnect/sendMessage)。"""
    if not ws:
        return ""
    out = ["", "  # ---------- WebSocket API ----------",
           "  WebSocketApi:",
           "    Type: AWS::ApiGatewayV2::Api",
           "    Properties:",
           "      Name: !Sub 'ryojaku-${Stage}-ws'",
           "      ProtocolType: WEBSOCKET",
           "      RouteSelectionExpression: '$request.body.action'"]
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
           f"      Target: !Sub 'integrations/${{WsInteg{rk}}}'",
           f"  WsPerm{rk}:",
           "    Type: AWS::Lambda::Permission",
           "    Properties:",
           f"      FunctionName: !Ref {lid}",
           "      Action: lambda:InvokeFunction",
           "      Principal: apigateway.amazonaws.com"]
    return "\n".join(out)

fns = [f for f in MAN if f["apiType"] != "WEBSOCKET"]
ws = [f for f in MAN if f["apiType"] == "WEBSOCKET"]

parts = [HEAD]
for f in MAN:  # function 本體(含 WS 的 function)
    parts.append(fn_block(f))
    parts.append("")
parts.append(ws_block(ws))
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

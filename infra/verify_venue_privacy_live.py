#!/usr/bin/env python3
# [B5-d] 自建場隱私規則的**線上**迴歸網（正典 PLAYER_APP_REDESIGN.md §5.1／§5.3／§15.4）
#
# 用法：python3 verify_venue_privacy_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗（**沒測到**，不可讀成通過）
#
# ── 這支答的是哪個問題 ────────────────────────────────────────────
#
# §15.4 的界線 1 寫著：[B5] 那六顆 commit **線上一條都沒驗過**。單元測試與突變
# 測試證明的是「程式裡的判準是對的」，證明不了「線上那份 Lambda 是這一版」。
# 這支就是去補那一句 —— 它打的是真的 API Gateway、真的 Lambda、真的 DDB。
#
# 🔴🔴 **部署前跑這支，它一定要是紅的（rc=1）。**
#    那不是壞掉，那是這把尺**有牙齒**的唯一證據：如果它在舊程式上就綠，
#    它量的就不是 [B5] 改的那些東西，而部署後的綠燈毫無資訊量。
#    ⇒ 判準是**兩次讀數的差**：部署前 P1～P4 紅、C1～C3 綠 ⇒ 尺對得準；
#      部署後全綠 ⇒ 這一版真的上去了。只跑後面那次，證明不了任何事。
#
# ── 為什麼是這些斷言 ──────────────────────────────────────────────
#
# 🔴 每個「應該被擋」都配一個「應該要通」，理由是同一個失效模式：
#    端點沒佈上／authorizer 壞掉／Lambda 直接 500 時，**所有負控都會變綠**。
#      - C3（真 token 查得到場地）撐著 P2／P3 整組
#      - P3b（active 的 hall **要有**電話）撐著 P3a —— 少了它，後端改成
#        「一律不給聯絡資訊」也會讓 P3a 綠，而那是另一個 bug（麻將館的電話
#        永遠看不到，症狀是「店家沒填」不是「被擋」）
#      - P4b（hall 建得起來）撐著 P4a —— 少了它，端點整支壞掉、一律 400
#        也會讓 P4a 綠
#
# 🔴 **不註冊帳號、不冒用真帳號**（同 verify_ruleset_live.py 的理由）：
#    直接在 Users 表放兩列合成 userId、自簽 token，跑完刪掉並 read-back。
#    兩個使用者是必要的 —— 「屋主看得到」與「路人看不到」要在同一輪裡分開量，
#    只有一個身分的話 isOwner 那一維沒有鑑別力。
#
# 🔴 **兩個 base 都要打。** App 實際烘進 bundle 的是自訂網域
#    `https://ryojaku-api.boyplaymj.com`（frontend/deploy-stg.sh），而 SAM 部署的是
#    execute-api 那一個。只驗後者的話，「自訂網域的 base path mapping 指到舊 stage」
#    會讓探針全綠而玩家吃到舊行為 —— **生產端執行時讀的是哪一份，就要量哪一份**。
#    ⇒ 用 `RYOJAKU_API_BASE=<url>` 覆寫本支要打的 base，兩個各跑一次。
#    （這條是 verify_ruleset_live.py 用同一個坑換來的，不是我推測的。）
#
# ⚠️ 寫入面積（跑完全部刪掉並 read-back 確認）：
#    Users 兩列、Venues 最多四列（P1 一列、P3 兩列、P4b 一列，
#    外加**部署前**那次 P4a 會意外建成的一列 —— 那正是它紅的方式）。
#    全部以 B5PROBE-DELETEME 開頭，收尾另有一道 Scan 掃殘留。

import base64
import hashlib
import hmac
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

REGION = "ap-southeast-1"
STACK = "ryojaku-app-stg"
PREFIX = "MahjongClubStg_"
USERS = PREFIX + "Users"
VENUES = PREFIX + "Venues"
MARK = "B5PROBE-DELETEME"

# 位移範圍（shared/venue_blur.go 的 HomeBlurMinMeters／HomeBlurMaxMeters）。
# 🔴 這兩個數字是**複製過來的**：探針去 import 後端常數就變成「用同一份定義
#    證明同一份定義」，對「線上那版是不是這個範圍」零鑑別力。
BLUR_MIN_M, BLUR_MAX_M = 300.0, 500.0
# 我這邊用等距柱面近似量距離，後端用的是同一個模型但參數各自代入 ⇒ 給 2% 容差。
BLUR_TOL = 0.02

TOTAL = 0
FAIL = 0
LAST_FP = ""


def pass_(msg):
    global TOTAL
    TOTAL += 1
    print(f"  ✅ {msg}")


def fail_(msg):
    global TOTAL, FAIL
    TOTAL += 1
    FAIL += 1
    print(f"  ❌ {msg}")
    if LAST_FP:
        print(f"      指紋：{LAST_FP}")


def check(desc, got, want):
    if got == want:
        pass_(f"{desc}（{got!r}）")
    else:
        fail_(f"{desc}：得到 {got!r}，期望 {want!r}")


def die(msg):
    """前置失敗 → rc=2。**不是** rc=1 —— 「沒測到」不可以跟「測了而失敗」同號。"""
    print(f"\n🔴 前置失敗（本輪什麼都沒驗到）：{msg}")
    sys.exit(2)


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign(payload: dict, secret: str) -> str:
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()
    return f"{header}.{body}.{b64(mac)}"


def sh(args):
    out = subprocess.run(args, capture_output=True, text=True)
    return out.returncode, out.stdout, out.stderr


def ssm(name: str) -> str:
    rc, out, err = sh(["aws", "ssm", "get-parameter", "--region", REGION, "--name", name,
                       "--with-decryption", "--query", "Parameter.Value", "--output", "text"])
    if rc != 0:
        die(f"讀不到 SSM {name}：{err.strip()[:200]}")
    return out.strip()


def ddb(*args):
    return sh(["aws", "dynamodb", *args, "--region", REGION])


def req(base, path, token=None, method="GET", payload=None):
    """回 (status, raw_text)。連不上一律回 (0, 錯誤字串)：
    絕不把「打不到」靜靜變成某個狀態碼。"""
    global LAST_FP
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(base + path, method=method, data=data)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw, code, hdrs = resp.read().decode(), resp.status, resp.headers
    except urllib.error.HTTPError as e:
        raw, code, hdrs = e.read().decode(), e.code, e.headers
    except Exception as e:
        LAST_FP = f"connection error: {e}"
        return 0, f"connection error: {e}"
    LAST_FP = f"x-amzn-errortype={hdrs.get('x-amzn-errortype', '(無)')} body={raw[:160]!r}"
    return code, raw


def meters(lat1, lng1, lat2, lng2):
    """等距柱面近似（與 venue_blur.go 同一個模型）。"""
    mpd = 111320.0
    dy = (lat2 - lat1) * mpd
    dx = (lng2 - lng1) * mpd * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def data_of(raw):
    """把回應的 data 取出來；**同時回原始文字** —— 「有沒有 phone 這個鍵」
    要看原文，parse 完再看 dict 也可以，但欄位缺席與值為空必須分得開。"""
    try:
        body = json.loads(raw)
    except Exception:
        return None
    return body.get("data")


def put_venue(item):
    rc, _, err = ddb("put-item", "--table-name", VENUES, "--item", json.dumps(item))
    if rc != 0:
        die(f"寫不進 {VENUES}：{err.strip()[:200]}")


def venue_item(vid, vtype, status, name, phone, hours, owner, lat, lng, addr=""):
    it = {
        "venueId": {"S": vid},
        "type": {"S": vtype},
        "status": {"S": status},
        "name": {"S": name},
        "phone": {"S": phone},
        "businessHours": {"S": hours},
        "ownerId": {"S": owner},
        "approxLocation": {"M": {"latitude": {"N": str(lat)}, "longitude": {"N": str(lng)}}},
        "dojoPaidUntil": {"N": "0"},
        "certifiedRefereeCount": {"N": "0"},
        "ratingPositive": {"N": "0"},
        "ratingCount": {"N": "0"},
        "createdAt": {"N": str(int(time.time()))},
        "updatedAt": {"N": str(int(time.time()))},
    }
    if addr:
        it["exactAddress"] = {"S": addr}
    return it


def main():
    tag = int(time.time())
    owner_uid = f"{MARK}-OWNER-{tag}"
    stranger_uid = f"{MARK}-STRANGER-{tag}"
    created = []          # 要清掉的 venueId
    users = [owner_uid, stranger_uid]

    print("══ 前置 ══")
    override = os.environ.get("RYOJAKU_API_BASE", "").strip()
    if override:
        api = override.rstrip("/")
        print(f"  API：{api}（RYOJAKU_API_BASE 覆寫 —— 這一輪量的是自訂網域那一份）")
    else:
        rc, out, err = sh(["aws", "cloudformation", "describe-stacks", "--stack-name", STACK,
                           "--region", REGION, "--query",
                           "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue",
                           "--output", "text"])
        api = out.strip()
        if rc != 0 or not api or api == "None":
            die(f"拿不到 RestApiUrl（stack={STACK}）：{err.strip()[:200]}")
        api = api.rstrip("/")
        print(f"  API：{api}（SAM 部署的那一份）")
    secret = ssm("/ryojaku/stg/JWT_SECRET")

    for uid in users:
        rc, _, err = ddb("put-item", "--table-name", USERS, "--item",
                         json.dumps({"userId": {"S": uid}, "displayName": {"S": MARK}}))
        if rc != 0:
            die(f"建不出測試使用者 {uid}：{err.strip()[:200]}")
    print(f"  測試使用者：{owner_uid} ／ {stranger_uid}")

    exp = int(time.time()) + 3600
    owner_tk = sign({"userId": owner_uid, "email": "probe-owner@example.com", "exp": exp}, secret)
    stranger_tk = sign({"userId": stranger_uid, "email": "probe-x@example.com", "exp": exp}, secret)

    # 精確座標（台北市中心附近）。P1 就是量「送這個進去，回來的差多遠」。
    EXACT_LAT, EXACT_LNG = 25.033964, 121.564468

    try:
        print("\n══ C：我到底打到了什麼（沒有這三條，下面全是假綠）══")
        code, _ = req(api, "/venue-detail", method="POST", payload={"venueId": "x"})
        check("C1 不帶 token 打 /venue-detail → 401（authorizer 生效）", code, 401)

        code, _ = req(api, "/no-such-venue-route", token=stranger_tk, method="POST", payload={})
        check("C2 沒佈的路徑 → 403（證明我不是在打一個對所有路徑都通的東西）", code, 403)

        # ── P4：create-venue 只收自助 type（§5.3 ③）──
        print("\n══ P4：create-venue 拒收 type=event（§5.3 ③）══")
        code, raw = req(api, "/create-venue", token=owner_tk, method="POST", payload={
            "type": "hall", "name": f"{MARK}-hall-{tag}",
            "approxLocation": {"latitude": EXACT_LAT, "longitude": EXACT_LNG}})
        d = data_of(raw)
        if code == 200 and d and d.get("venueId"):
            created.append(d["venueId"])
        check("P4b【反控】麻將館建得起來 → 200（少了它，端點整支壞掉也會讓 P4a 綠）", code, 200)

        code, raw = req(api, "/create-venue", token=owner_tk, method="POST", payload={
            "type": "event", "name": f"{MARK}-event-{tag}",
            "approxLocation": {"latitude": EXACT_LAT, "longitude": EXACT_LNG}})
        d = data_of(raw)
        if d and d.get("venueId"):
            created.append(d["venueId"])   # 部署前它會真的建成 —— 一樣要清掉
        check("P4a 玩家自助建 type=event → 400（活動場由官方建立）", code, 400)
        if code == 400:
            check("P4a' 擋下來的理由是那一條，不是別的驗證錯誤",
                  "活動場由官方建立" in raw, True)

        # ── P1：後端自己位移自建場座標（§5.1／§5.3 ①）──
        print("\n══ P1：後端位移自建場座標（§5.3 ①）══")
        code, raw = req(api, "/create-venue", token=owner_tk, method="POST", payload={
            "type": "home", "name": f"{MARK}-home-{tag}",
            "exactAddress": "台北市信義區測試路 1 號",
            "phone": "0900-000-001", "businessHours": "測試時段",
            # 🔴 刻意送**精確**座標（前端會先位移，這裡就是要繞過它）
            "approxLocation": {"latitude": EXACT_LAT, "longitude": EXACT_LNG,
                               "placeName": f"{MARK}-地名", "geohash": "wsqqqqqqq"}})
        home_id = None
        d = data_of(raw)
        if code != 200 or not d:
            fail_(f"P1 未測到：建立自建場失敗（code={code}）")
        else:
            home_id = d.get("venueId")
            created.append(home_id)
            loc = d.get("approxLocation") or {}
            dist = meters(EXACT_LAT, EXACT_LNG, loc.get("latitude", EXACT_LAT),
                          loc.get("longitude", EXACT_LNG))
            print(f"      位移實測：{dist:.1f} m")
            ok = BLUR_MIN_M * (1 - BLUR_TOL) <= dist <= BLUR_MAX_M * (1 + BLUR_TOL)
            check(f"P1a 公開座標離送進去的精確座標 300–500 m（實測 {dist:.1f} m）", ok, True)
            check("P1b placeName 被清掉（否則模糊化白做）", loc.get("placeName", ""), "")
            check("P1c geohash 被清掉", loc.get("geohash", ""), "")

        # ── P2：路人查自建場拿不到 phone／ownerId（§5.3 ②）──
        print("\n══ P2：路人查自建場的白名單回應（§5.3 ②）══")
        if not home_id:
            fail_("P2 未測到（P1 沒有建出自建場）")
        else:
            code, raw = req(api, "/venue-detail", token=stranger_tk, method="POST",
                            payload={"venueId": home_id})
            check("C3【正控】真 token 查得到那筆場地 → 200（撐著 P2／P3 整組）", code, 200)
            d = data_of(raw) or {}
            check("P2a 路人拿不到 phone", "phone" in d, False)
            check("P2b 路人拿不到 ownerId", "ownerId" in d, False)
            check("P2c 路人拿不到 exactAddress（§5.1 舊有規則，順帶回歸）",
                  "exactAddress" in d, False)
            check("P2d 路人的 isOwner 是 false", d.get("isOwner"), False)
            check("P2e 路人拿不到 businessHours（自建場不是公開 type）",
                  "businessHours" in d, False)

            code, raw = req(api, "/venue-detail", token=owner_tk, method="POST",
                            payload={"venueId": home_id})
            d2 = data_of(raw) or {}
            # 🔴 屋主那一格是 P2d 的反控：少了它，isOwner 直接寫死 false 也會全綠。
            check("P2f【反控】屋主自己查 isOwner 是 true", d2.get("isOwner"), True)
            check("P2g【反控】屋主拿得到 exactAddress（否則 P2c 也可能是「誰都拿不到」）",
                  "exactAddress" in d2, True)

        # ── P3：聯絡資訊要 status==active（§5.3 ④，[B5-b2]）──
        print("\n══ P3：聯絡資訊也要 status==active（§5.3 ④）══")
        pend_id = f"{MARK}-PENDHALL-{tag}"
        act_id = f"{MARK}-ACTHALL-{tag}"
        put_venue(venue_item(pend_id, "hall", "pending", f"{MARK}-待審麻將館",
                             "0900-000-002", "12:00–02:00", owner_uid, 25.04, 121.56))
        created.append(pend_id)
        put_venue(venue_item(act_id, "hall", "active", f"{MARK}-已審麻將館",
                             "0900-000-003", "12:00–02:00", owner_uid, 25.04, 121.56))
        created.append(act_id)

        code, raw = req(api, "/venue-detail", token=stranger_tk, method="POST",
                        payload={"venueId": pend_id})
        d = data_of(raw) or {}
        check("P3-pre 查得到那筆待審麻將館 → 200", code, 200)
        check("P3a 待審（pending）的麻將館：路人拿不到 phone", "phone" in d, False)
        check("P3b 待審的麻將館：路人拿不到 businessHours", "businessHours" in d, False)

        code, raw = req(api, "/venue-detail", token=stranger_tk, method="POST",
                        payload={"venueId": act_id})
        d = data_of(raw) or {}
        # 🔴 這兩條是 P3a／P3b 的反控。少了它們，後端改成「一律不給聯絡資訊」
        #    也會讓上面全綠 —— 而那是另一個 bug（麻將館的電話永遠看不到，
        #    症狀是「店家沒填」不是「被擋」，在畫面上逐字相同）。
        check("P3c【反控】已審（active）的麻將館：路人**拿得到** phone", d.get("phone"), "0900-000-003")
        check("P3d【反控】已審的麻將館：路人**拿得到** businessHours",
              d.get("businessHours"), "12:00–02:00")

    finally:
        print("\n══ 清理（寫入面積必須歸零）══")
        left = []
        for vid in created:
            if not vid:
                continue
            rc, _, err = ddb("delete-item", "--table-name", VENUES, "--key",
                             json.dumps({"venueId": {"S": vid}}))
            if rc != 0:
                left.append(vid)
                print(f"  ⚠️ 刪不掉 venue {vid}：{err.strip()[:120]}")
        for uid in users:
            rc, _, err = ddb("delete-item", "--table-name", USERS, "--key",
                             json.dumps({"userId": {"S": uid}}))
            if rc != 0:
                left.append(uid)
                print(f"  ⚠️ 刪不掉 user {uid}：{err.strip()[:120]}")
        # 🔴 read-back：刪掉了與「刪除指令回 0 但東西還在」不可以同形。
        #    掃的是**整張表**找 MARK 開頭的殘留 —— 包含前幾輪跑掛掉留下的。
        rc, out, err = ddb("scan", "--table-name", VENUES,
                           "--filter-expression", "begins_with(venueId, :p)",
                           "--expression-attribute-values", json.dumps({":p": {"S": MARK}}),
                           "--projection-expression", "venueId", "--output", "json")
        if rc != 0:
            print(f"  ⚠️ 殘留掃描失敗（不能宣稱清乾淨了）：{err.strip()[:120]}")
        else:
            items = json.loads(out).get("Items", [])
            if items:
                print(f"  ⚠️ Venues 仍有 {len(items)} 筆 {MARK} 殘留："
                      f"{[i['venueId']['S'] for i in items][:5]}")
            else:
                print(f"  ✅ Venues 沒有 {MARK} 殘留（read-back 掃過整張表）")

    print(f"\n══ 結果：{TOTAL - FAIL}/{TOTAL} ══")
    if FAIL:
        print("❌ 有斷言失敗。")
        print("🔴 **部署前跑本支，P1～P4 紅是預期的** —— 那是這把尺有牙齒的證據；")
        print("   要看的是 C1／C2／C3 有沒有綠（綠＝我確實打到了對的端點）。")
        print("   部署後仍然紅才是真的有問題。")
        return 1
    print(f"✅ 全部通過（base={api}）。⚠️ 界線：這證明的是**這一刻**、**這個 base** 的行為，")
    print("   不證明另一個 base（自訂網域／execute-api，看你剛剛跑的是哪個）也一樣，")
    print("   也不證明別的路徑（後台 admin-venues、venue-list）也擋著。")
    return 0


if __name__ == "__main__":
    sys.exit(main())

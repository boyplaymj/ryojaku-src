#!/usr/bin/env python3
# 「開團之後，Users 那一列上結構不認得的屬性還在不在」的**線上 stg** 驗收。
#
# 用法：python3 verify_user_row_preserved_live.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置或清理失敗（**沒測到**，不可讀成通過）
#
# 為什麼存在（2026-10-13）：web_create_game／web_submit_rating 原本是「GetItem → 改幾個欄位 → 整列 PutItem」，
# 而 shared.User 不認得 pwChangedAt／deleteRequestedAt ⇒ 這些屬性被洗掉。最直接的後果：
# 一個人改密碼或「登出所有裝置」之後開了一個團，作廢的舊 JWT 又變回有效。
# 修法（shared.UpdateUserFields）只在單元層與資料庫層驗過，這支走真的 POST /create-game。
#
# 做法同 verify_account_deletion_live.py：合成帳號＋自簽 token＋跑完刪掉並讀回。
# 三格互相撐著：
#   R1 開團真的成功、點數真的被扣 —— 少了它，「屬性還在」與「那個端點根本沒寫 Users」分不開。
#   R2 pwChangedAt 與一個結構不認得的屬性都還在。
#   R3 一張簽發時間早於 pwChangedAt 的舊 token，開團之後仍然被拒 —— 這才是使用者會碰到的那件事。
#
# ⚠️ 量不到的：評價那條路（要一場有成員、已結束的團局）；它與開團走同一支 shared.UpdateUserFields。
# ⚠️ 寫入面積：Users、Games、ChatRooms、ChatUserMemberships、PointTransactions 各最多數列，跑完刪掉。

import json
import sys
import time

from verify_account_deletion_live import (  # 同目錄的輔助函式：簽 token、打 API、呼叫 aws cli
    REGION, STACK, PREFIX, USERS, check, pass_, fail_, die, sign, sh, ssm, ddb, req, jbody, get_user,
)
import verify_account_deletion_live as base

MARK = "ROWPROBE-DELETEME"


def query_keys(table, pk_name, pk_value, key_names):
    rc, out, _ = ddb("query", "--table-name", table, "--key-condition-expression", "#p = :u",
                     "--expression-attribute-names", json.dumps({"#p": pk_name}),
                     "--expression-attribute-values", json.dumps({":u": {"S": pk_value}}))
    if rc != 0 or not out.strip():
        return []
    return [{k: it[k] for k in key_names} for it in json.loads(out).get("Items", [])]


def main():
    tag = int(time.time())
    uid = f"{MARK}-{tag}"
    print("══ 前置 ══")
    rc, out, err = sh(["aws", "cloudformation", "describe-stacks", "--stack-name", STACK, "--region", REGION,
                       "--query", "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue", "--output", "text"])
    api = out.strip().rstrip("/")
    if rc != 0 or not api or api == "None":
        die(f"拿不到 RestApiUrl：{err.strip()[:200]}")
    secret = ssm("/ryojaku/stg/JWT_SECRET")

    now = int(time.time())
    revoked_at = now - 600          # 十分鐘前「登出所有裝置」
    rc, _, err = ddb("put-item", "--table-name", USERS, "--item", json.dumps({
        "userId": {"S": uid}, "displayName": {"S": MARK}, "email": {"S": f"rowprobe-{tag}@example.invalid"},
        "emailVerified": {"BOOL": True}, "accountType": {"S": "app"}, "points": {"N": "100000"},
        "pwChangedAt": {"N": str(revoked_at)}, "probeMarker": {"S": "結構不認得的欄位"}}))
    if rc != 0:
        die(f"建不出測試使用者：{err.strip()[:200]}")
    fresh_tk = sign({"userId": uid, "email": "", "iat": now - 5, "exp": now + 3600}, secret)
    stale_tk = sign({"userId": uid, "email": "", "iat": revoked_at - 60, "exp": now + 3600}, secret)
    print(f"  測試使用者：{uid}（points 100000、pwChangedAt={revoked_at}）")

    try:
        print("\n══ R0 對照·開團之前 ══")
        code, _, _ = req(api, "/chat/rooms", token=fresh_tk)
        check("R0a 新 token 可用", code, 200)
        code, _, _ = req(api, "/chat/rooms", token=stale_tk)
        check("R0b 早於 pwChangedAt 的舊 token 被拒", code, 401)

        print("\n══ R1 開團 ══")
        start = time.strftime("%Y-%m-%dT%H:%M:%S+08:00", time.gmtime(now + 8 * 3600 + 3 * 86400))
        code, raw, _ = req(api, "/create-game", token=fresh_tk, method="POST", payload={
            "type": "one-time", "gameType": "taiwan16", "placeName": "ROWPROBE 測試場地", "location": "測試地址",
            "latitude": 25.03, "longitude": 121.56, "needPlayers": 3, "stakes": "probe", "startTime": start,
            "rules": [], "features": [], "restrictions": [], "images": []})
        body = jbody(raw)
        check("R1 狀態碼", code, 200)
        item = get_user(uid) or {}
        pts = int(item.get("points", {}).get("N", "0"))
        if pts < 100000 and pts > 0:
            pass_(f"R1b 點數真的被扣了（100000 → {pts}）⇒ 這個端點確實寫了 Users 那一列")
        else:
            fail_(f"R1b 點數沒有變（{pts}）⇒ 端點沒寫到 Users，下面兩格不算數")

        print("\n══ R2 Users 那一列上結構不認得的屬性 ══")
        check("R2a pwChangedAt 還在而且沒變", item.get("pwChangedAt", {}).get("N"), str(revoked_at))
        check("R2b probeMarker 還在", item.get("probeMarker", {}).get("S"), "結構不認得的欄位")

        print("\n══ R3 開團之後，作廢的舊 token 仍然被拒 ══")
        code, _, _ = req(api, "/chat/rooms", token=stale_tk)
        check("R3 舊 token", code, 401)
    finally:
        print("\n══ 清理 ══")
        left = []
        # 🔴 不靠回應裡的 gameId 找要刪的團局：第一版這樣寫，而回應的形狀跟我猜的不一樣 ⇒ game_id 是 None
        #    ⇒ 團局與聊天室留在 stg 上，而清理還印了「已刪除並讀回確認」。改成直接去表裡找這個人主辦的。
        rc, out, err = ddb("scan", "--table-name", PREFIX + "Games", "--filter-expression", "hostUserId = :u",
                           "--expression-attribute-values", json.dumps({":u": {"S": uid}}),
                           "--projection-expression", "gameId", "--consistent-read")
        if rc != 0:
            print(f"🔴 清理：找不到這個人主辦的團局（scan 失敗）：{err.strip()[:160]}")
            sys.exit(2)
        game_ids = [it["gameId"]["S"] for it in json.loads(out).get("Items", [])]
        for gid in game_ids:
            ddb("delete-item", "--table-name", PREFIX + "Games", "--key", json.dumps({"gameId": {"S": gid}}))
            ddb("delete-item", "--table-name", PREFIX + "ChatRooms", "--key", json.dumps({"RoomID": {"S": gid}}))
        for table, pk, keys in [(PREFIX + "ChatUserMemberships", "UserID", ["UserID", "LastMessageTime#RoomID"]),
                                (PREFIX + "PointTransactions", "userId", ["userId", "sortKey"])]:
            for key in query_keys(table, pk, uid, keys):
                ddb("delete-item", "--table-name", table, "--key", json.dumps(key))
            if query_keys(table, pk, uid, keys):
                left.append(table)
        ddb("delete-item", "--table-name", USERS, "--key", json.dumps({"userId": {"S": uid}}))
        if get_user(uid):
            left.append(USERS)
        for gid in game_ids:
            for table, key in [(PREFIX + "Games", {"gameId": {"S": gid}}), (PREFIX + "ChatRooms", {"RoomID": {"S": gid}})]:
                rc, out, _ = ddb("get-item", "--table-name", table, "--key", json.dumps(key), "--consistent-read")
                if rc != 0 or (out.strip() and json.loads(out).get("Item")):
                    left.append(table)
        if left:
            print(f"🔴 清理失敗，殘留在 {left}（userId={uid} gameIds={game_ids}）")
            sys.exit(2)
        print(f"  測試資料已刪除並讀回確認（團局 {len(game_ids)} 個：{game_ids}）")

    print(f"\n結果：{base.TOTAL - base.FAIL}/{base.TOTAL} 通過")
    sys.exit(1 if base.FAIL else 0)


if __name__ == "__main__":
    main()

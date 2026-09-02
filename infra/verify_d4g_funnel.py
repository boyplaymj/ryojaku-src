#!/usr/bin/env python3
# D4-g 驗收：漏斗埋點（kind=open／asr）的線上迴歸網
#   POST /voice-corrections        寫入端收 kind
#   GET  /admin/voice-corrections  讀取端排除事件列 ＋ 回 pageEvents
# 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §11.11
#
# 用法：python3 verify_d4g_funnel.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗或**量不到**（不可讀成通過）
#
# ── 這支為什麼必須存在 ──────────────────────────────────────────
#
# 🔴 姊妹檔 verify_voice_corrections.py（D3-d）對 kind／pageEvents **零命中**
#    （實查 grep）。少了本份，「D4-g 上線了」與「沒上線」在線上**逐字相同**：
#    舊版 Go 忽略不認得的欄位 ⇒ 送 kind=open 照樣回 200、照樣落庫、
#    後台照樣把它算進 data。每一個狀態碼都一樣，只有欄位會說話。
#
# 🔴 因此 E4（打錯字的 kind → 400）是本份的**版本判別器**：
#    舊版對它回 200。它紅了要先問「是不是根本沒部署」，不是先改斷言。
#
# ── 量測方法：差分，不是絕對值 ────────────────────────────────
#
# 🔴 pageEvents 是**整頁**（Scan 200 筆）的計數，不是「我這個 userId 的」。
#    別人的列也會計進去 ⇒ 斷言 `open == 1` 是錯的尺。
#    ⇒ 寫入**前**先讀一次當基線，寫入**後**再讀一次，比對**增量**。
#
# 🔴 而差分只有在「兩次都掃得到整張表」時才能歸因給我。
#    任一次回傳帶 nextCursor ⇒ 我寫的列可能落在別頁，增量無從歸因
#    ⇒ **rc=2（量不到）**，不是 rc=1，更不是靜靜通過。

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# 🔴 判準層寧可 import 姊妹檔也不抄第三份：token 自簽、req()、ddb()、清理規矩
#    都在那支裡，抄過來就會有兩份各自漂移的實作。
#    （它的 main() 有 __name__ 守衛，import 不會觸發整份跑起來 —— 已實查。）
import verify_voice_corrections as vc

MARK = "D4GREG-DELETEME"


def die(msg):
    print(f"\n🔴 前置失敗／量不到（本輪什麼都沒驗到）：{msg}")
    sys.exit(2)


def admin_page(tok):
    """讀一頁後台。回 (data, pageEvents, skipped, complete)。"""
    code, resp = vc.req("GET", "/admin/voice-corrections", token=tok)
    if code != 200 or not isinstance(resp, dict):
        die(f"admin 讀取端沒回 200（{code}）：{str(resp)[:200]}")
    pe = resp.get("pageEvents")
    if pe is None:
        die("回傳沒有 pageEvents 欄位 —— D4-g 的讀取端沒有上線（或部署還在傳播）。"
            "這正是本份要分辨的那件事，不要把它讀成 0。")
    complete = not resp.get("nextCursor")
    return resp.get("data") or [], pe, resp.get("skipped"), complete


def ev(pe, key):
    return int(pe.get(key) or 0)


def err_of(pe, code):
    return int((pe.get("asrErrors") or {}).get(code) or 0)


def main():
    ts_tag = int(time.time())

    print("══ 前置：取金鑰、造 token、註冊測試帳號 ══")
    user_secret = vc.ssm("/ryojaku/stg/JWT_SECRET")
    admin_secret = vc.ssm("/ryojaku/stg/ADMIN_JWT_SECRET")
    admin_tok = vc.sign({"sub": "s2admin", "role": "super_admin",
                         "exp": int(time.time()) + 3600}, admin_secret)
    if user_secret == admin_secret:
        die("JWT_SECRET 與 ADMIN_JWT_SECRET 相同 —— 環境不對，不往下驗")

    email = f"d4greg+{ts_tag}@example.com"
    code, body = vc.req("POST", "/app-register", body={
        "email": email, "password": "D4gReg12345!", "displayName": MARK})
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        die("註冊測試帳號失敗（最常見原因：app-register 每 IP 每小時 10 次的限流）。"
            f"回應 {code}：{str(body)[:200]}")
    user_tok = body["token"]
    user_id = (body.get("data") or body.get("user") or {}).get("userId", "")
    if not user_id:
        die(f"註冊成功但取不到 userId：{str(body)[:200]}")
    print(f"  測試帳號 {user_id}")

    print("\n══ 基線：寫入前先讀一頁 ══")
    base_data, base_pe, base_skipped, base_complete = admin_page(admin_tok)
    if not base_complete:
        die("基線那一頁帶著 nextCursor —— 表比一頁大，增量無法歸因給我寫的列")
    print(f"  基線 pageEvents={json.dumps(base_pe, ensure_ascii=False)} "
          f"data={len(base_data)} skipped={base_skipped}")

    # 🔴 每一發都**故意夾帶** added/removed/parsed/corrected。
    #    第二道防線（寫入端不寫這些欄）只有在「body 真的送了」時才驗得到；
    #    不送的話「防線生效」與「我根本沒送」在 DDB 上逐欄相同。
    payload = {"text": "自摸平胡", "normalizedText": "自摸平胡",
               "parsed": ["selfDraw"], "corrected": ["selfDraw", "pinghu"],
               "added": ["pinghu"], "removed": ["x"], "unmatched": "",
               "hadDiff": True, "rulesetVersion": "v1", "engineVersion": "e1",
               "ts": ts_tag}

    print("\n══ 寫入端：kind 的四種輸入 ══")
    code, _ = vc.req("POST", "/voice-corrections", token=user_tok,
                     body=dict(payload, kind="open"))
    vc.check("E1【正控】kind=open → 200", code, 200, fp=True)

    code, _ = vc.req("POST", "/voice-corrections", token=user_tok,
                     body=dict(payload, kind="asr", asrOk=False,
                               asrTrack="native", asrError="audio-capture"))
    vc.check("E2【正控】kind=asr（失敗）→ 200", code, 200, fp=True)

    code, _ = vc.req("POST", "/voice-corrections", token=user_tok,
                     body=dict(payload, kind="asr", asrOk=True, asrTrack="web"))
    vc.check("E3【正控】kind=asr（成功）→ 200", code, 200, fp=True)

    # 🔴 版本判別器。舊版 Go 忽略不認得的欄位 ⇒ 這發會回 200 並落庫成一筆假訂正。
    code, _ = vc.req("POST", "/voice-corrections", token=user_tok,
                     body=dict(payload, kind="bogus-kind"))
    vc.check("E4 認不得的 kind → 400（不吞成 correction；舊版對它回 200）",
             code, 400, fp=True)

    # 缺 kind ＝ 既有資料 ⇒ 必須仍當成 correction 並保留 added/removed。
    code, _ = vc.req("POST", "/voice-corrections", token=user_tok, body=payload)
    vc.check("E5【正控】不帶 kind → 200（既有資料的預設路徑）", code, 200, fp=True)

    print("\n══ 落庫：欄位形狀 ══")
    items = vc.scan_mine(user_id)
    vc.check("E6 DDB 實際筆數（E1/E2/E3/E5 四筆；E4 那筆不該寫進去）", len(items), 4)

    def rows_of(kind):
        return [i for i in items if (i.get("kind") or {}).get("S") == kind]

    opens, asrs, corrs = rows_of("open"), rows_of("asr"), rows_of("correction")
    vc.check("E7 kind=open 落庫 1 筆（欄位存在＝寫入端真的收了 kind）", len(opens), 1)
    vc.check("E8 kind=asr 落庫 2 筆", len(asrs), 2)
    vc.check("E9 不帶 kind 的那筆落庫成 kind='correction'（既有資料不會被丟掉）",
             len(corrs), 1)

    SPILL = ["added", "removed", "parsed", "corrected"]
    leaked = sorted({f for r in opens + asrs for f in SPILL if f in r})
    if leaked:
        vc.fail_(f"E10 事件列帶著 {leaked} 進表 —— 第二道防線失效，"
                 "假的訂正建議會被 extractSuggestions 回灌進家規台數表")
    else:
        vc.pass_(f"E10 事件列不含 {SPILL}（即使 body 確實送了）")

    # 🔴 E10 的尺的正控：correction 那筆**必須**有 added/removed。
    #    少了這條，「防線生效」與「我的探針根本沒送這些欄」在 E10 上逐字相同。
    if corrs and all(f in corrs[0] for f in ("added", "removed")):
        vc.pass_("E11【尺的正控】correction 那筆確實有 added/removed"
                 "（⇒ E10 的『沒有』是 kind 造成的，不是我沒送）")
    else:
        vc.fail_("E11 correction 那筆也沒有 added/removed —— E10 這把尺零鑑別力，"
                 f"它的綠燈不算數。欄位={sorted(corrs[0].keys()) if corrs else '(無列)'}")

    failed_asr = [r for r in asrs if (r.get("asrOk") or {}).get("BOOL") is False]
    if len(failed_asr) == 1 and (failed_asr[0].get("asrError") or {}).get("S") == "audio-capture":
        vc.pass_("E12 asr 失敗列帶著 asrOk=false ＋ asrError='audio-capture'")
    else:
        vc.fail_(f"E12 asr 失敗列的欄位不對：{json.dumps(failed_asr, ensure_ascii=False)[:200]}")

    print("\n══ 讀取端：事件列不進 data，另計 pageEvents ══")
    after_data, after_pe, after_skipped, after_complete = admin_page(admin_tok)
    if not after_complete:
        die("寫入後那一頁帶著 nextCursor —— 增量無法歸因，本輪的 pageEvents 斷言不算數")
    print(f"  之後 pageEvents={json.dumps(after_pe, ensure_ascii=False)} "
          f"data={len(after_data)} skipped={after_skipped}")

    mine = [r for r in after_data if r.get("userId") == user_id]
    vc.check("E13 後台 data 只收到我的 1 筆 correction（3 筆事件列被排除）", len(mine), 1)

    if isinstance(base_skipped, int) and isinstance(after_skipped, int):
        vc.check("E14 skipped 增量為 0（事件列不併進『形狀壞掉』那一格）",
                 after_skipped - base_skipped, 0)
    else:
        vc.fail_(f"E14 skipped 不是數字：基線 {base_skipped!r} → 之後 {after_skipped!r}")

    for key, want, why in (
            ("open", 1, "進頁事件"),
            ("asrOk", 1, "ASR 成功"),
            ("asrFailed", 1, "ASR 失敗"),
            ("other", 0, "認不得的 kind —— E4 被 400 擋下,不該有任何一筆落庫")):
        vc.check(f"E15.{key} pageEvents.{key} 增量（{why}）",
                 ev(after_pe, key) - ev(base_pe, key), want)

    vc.check("E16 asrErrors['audio-capture'] 增量（錯誤原因有被分類保存）",
             err_of(after_pe, "audio-capture") - err_of(base_pe, "audio-capture"), 1)

    print("\n── 清理 ──")
    left = vc.scan_mine(user_id)
    for it in left:
        rc, _, err = vc.ddb("delete-item", "--table-name", vc.TABLE, "--key",
                            json.dumps({"pk": it["pk"], "sk": it["sk"]}))
        if rc != 0:
            vc.fail_(f"刪除失敗：{err.strip()[:160]}")
    if vc.scan_mine(user_id):
        vc.fail_("VoiceCorrections 仍有殘留")
    else:
        vc.pass_(f"已清掉 {len(left)} 筆測試資料")

    # 帳號自己收（規矩同姊妹檔：只認「本次這個 userId」，不做跨帳號孤兒清掃）。
    acct_left = 0
    for tbl in ("Users", "AuthIdentities", "AuthTokens"):
        rc, out, err = vc.ddb("scan", "--table-name", vc.PREFIX + tbl, "--output", "json")
        if rc != 0:
            vc.fail_(f"清帳號時掃 {tbl} 失敗：{err.strip()[:160]}")
            continue
        d = json.loads(out)
        if d.get("LastEvaluatedKey"):
            vc.fail_(f"{tbl} 未分頁完 —— 不宣稱已清乾淨")
            continue
        rc2, kout, _ = vc.ddb("describe-table", "--table-name", vc.PREFIX + tbl,
                              "--query", "Table.KeySchema[].AttributeName", "--output", "json")
        kn = json.loads(kout) if rc2 == 0 else []
        for it in d.get("Items", []):
            if user_id not in json.dumps(it, ensure_ascii=False):
                continue
            if not kn or not all(k in it for k in kn):
                continue
            rc3, _, err3 = vc.ddb("delete-item", "--table-name", vc.PREFIX + tbl,
                                  "--key", json.dumps({k: it[k] for k in kn}))
            if rc3 != 0:
                vc.fail_(f"刪 {tbl} 失敗：{err3.strip()[:160]}")
                acct_left += 1
            else:
                print(f"  刪 {tbl}")
    if acct_left == 0:
        vc.pass_(f"測試帳號 {user_id} 已清（Users / AuthIdentities / AuthTokens）")

    print(f"\n══ 斷言：通過 {vc.TOTAL - vc.FAIL} / 共 {vc.TOTAL}（失敗 {vc.FAIL}）══")
    print("══ 全部通過 ══" if vc.FAIL == 0 else f"══ 有 {vc.FAIL} 項失敗 ══")
    sys.exit(1 if vc.FAIL else 0)


if __name__ == "__main__":
    main()

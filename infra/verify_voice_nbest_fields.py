#!/usr/bin/env python3
# §3.5a 驗收：N-best 兩個新欄位（asrCandidates／asrChosen）的**線上**往返
#   POST /voice-corrections        寫入端真的收下並落庫（含 0 與缺欄的區別）
#   GET  /admin/voice-corrections  讀取端真的回四格（證明新版 admin lambda 已上線）
# 正典：/opt/sml/repo/tools/mahjong-tai/DESIGN_APP.md §3.5 / §3.5a
#
# 用法：python3 verify_voice_nbest_fields.py
# 退出碼：0 = 全過；1 = 有斷言失敗；2 = 前置失敗（**沒測到**，不可讀成通過）
#
# ── 為什麼要有這一支（既有 verify_voice_corrections.py 不夠）──────────
#
# 🔴 那支是 D3-d 寫的，它的 22 條斷言一條都沒有碰過這兩個新欄位 ⇒ 部署後它全綠，
#    與「新欄位整個沒接上」逐字相同。
#
# 🔴 這兩個欄位存在的**唯一理由**就是「0」與「缺欄」要分得出來
#    （candidates=0「一條都沒有」／chosen=0「選了首選」 vs 舊版前端根本沒送）。
#    ⇒ 本檔的核心斷言是 N2（送 0 → 落庫成 0）與 N4（不送 → 欄位不存在）。
#    少了 N4，後端把兩個欄位無條件寫 0 也會讓 N2 變綠 —— N4 是 N2 的反控，不可省。
#
# 🔴 N6 是讀取端的正控／反控成對：四格鍵齊全 ⇒ 新版已上線；四格缺而 asrOk 在
#    ⇒ 那是**舊版 lambda**，不是端點壞掉。兩者處置不同，所以要分得出來。
#
# ⚠️ 界線：本檔驗的是「欄位收得到、存得下、讀得出四格」。
#    四格**分類分得對不對**由 backend main_test.go 的單元測試涵蓋；
#    而「原生軌到底給不給多條候選」要真機才知道，本檔量不到（§3.5 未決）。

import json
import sys
import time

sys.path.insert(0, "/opt/sml/ryojaku-src/infra")
import verify_voice_corrections as vc  # 沿用 req/ssm/sign/ddb/scan_mine 與位址常數

TOTAL = 0
FAIL = 0
MARK = "NBEST-DELETEME"


def pass_(msg):
    global TOTAL
    TOTAL += 1
    print(f"  ✅ {msg}")


def fail_(msg):
    global TOTAL, FAIL
    TOTAL += 1
    FAIL += 1
    print(f"  ❌ {msg}")


def check(desc, ok, detail=""):
    if ok:
        pass_(desc)
    else:
        fail_(f"{desc}{('：' + detail) if detail else ''}")


def die(msg):
    print(f"\n🛑 前置失敗（**沒測到**，不是通過）：{msg}")
    sys.exit(2)


def attr_n(item, name):
    """回 (present, value)。present=False 代表**欄位不存在**，與值為 0 不同。"""
    v = item.get(name)
    if v is None:
        return False, None
    if "N" not in v:
        return True, f"型別不是 N 而是 {list(v.keys())}"
    return True, int(v["N"])


def main():
    global FAIL
    base_ts = int(time.time())

    print("══ 前置：註冊測試帳號 ══")
    email = f"nbest+{base_ts}@example.com"
    code, body = vc.req("POST", "/app-register", body={
        "email": email, "password": "NbEst12345!", "displayName": MARK})
    if code != 200 or not isinstance(body, dict) or not body.get("token"):
        die("註冊測試帳號失敗（最常見原因：app-register 每 IP 每小時 10 次的限流）。"
            f"回應 {code}：{str(body)[:200]}")
    user_tok = body["token"]
    user_id = (body.get("data") or body.get("user") or {}).get("userId", "")
    if not user_id:
        die(f"註冊成功但取不到 userId：{str(body)[:200]}")
    print(f"  測試帳號 {user_id}")

    admin_secret = vc.ssm("/ryojaku/stg/ADMIN_JWT_SECRET")
    admin_tok = vc.sign(
        {"sub": "s2admin", "role": "super_admin", "exp": base_ts + 3600}, admin_secret)

    # ── 五發，每一發問一個不同的問題 ──────────────────────────────
    # tag 只用來把落庫的列認回來（text 欄原樣存）。
    CASES = [
        ("A", {"asrCandidates": 3, "asrChosen": 2}),   # 換手：兩欄都要在
        ("B", {"asrCandidates": 3, "asrChosen": 0}),   # 🔴 chosen=0 必須落庫成 0
        ("C", {"asrCandidates": 1, "asrChosen": 0}),   # 只有一條
        ("D", {}),                                     # 🔴 反控：不送 ⇒ 欄位不該存在
        ("E", {"asrCandidates": -1, "asrChosen": -1}), # 負數視同沒送
    ]

    print("\n══ 寫入端：POST /voice-corrections（kind=asr）══")
    for i, (tag, extra) in enumerate(CASES):
        payload = {
            "kind": "asr", "text": f"{MARK}-{tag}", "normalizedText": "",
            "unmatched": "", "hadDiff": False,
            "rulesetVersion": "v1", "engineVersion": "e1",
            "ts": base_ts + i, "asrOk": True, "asrTrack": "web",
        }
        payload.update(extra)
        code, resp = vc.req("POST", "/voice-corrections", token=user_tok, body=payload)
        check(f"N0-{tag} 寫入回 200（帶 {extra or '不帶新欄位'}）", code == 200,
              f"回 {code}：{str(resp)[:160]}")
    if FAIL:
        die("寫入端沒全部收下 —— 後面的落庫斷言會變成在量別的東西")

    rows = {}
    for it in vc.scan_mine(user_id):
        t = it.get("text", {}).get("S", "")
        if t.startswith(MARK + "-"):
            rows[t.rsplit("-", 1)[-1]] = it
    if sorted(rows) != ["A", "B", "C", "D", "E"]:
        die(f"落庫的列認不齊（拿到 {sorted(rows)}）—— 少了哪一發就等於沒驗那一條")

    print("\n══ 落庫：0 與缺欄必須分得出來 ══")
    pa, va = attr_n(rows["A"], "asrCandidates")
    pb, vb = attr_n(rows["A"], "asrChosen")
    check("N1 換手那筆：asrCandidates=3 且 asrChosen=2", (pa, va, pb, vb) == (True, 3, True, 2),
          f"實際 candidates={(pa, va)} chosen={(pb, vb)}")

    pb0, vb0 = attr_n(rows["B"], "asrChosen")
    check("N2【核心】asrChosen=0 落庫成 0（不是被當成沒送而消失）", (pb0, vb0) == (True, 0),
          f"實際 {(pb0, vb0)}")

    pc, vc_ = attr_n(rows["C"], "asrCandidates")
    check("N3 只有一條那筆：asrCandidates=1", (pc, vc_) == (True, 1), f"實際 {(pc, vc_)}")

    pd1, _ = attr_n(rows["D"], "asrCandidates")
    pd2, _ = attr_n(rows["D"], "asrChosen")
    check("N4【N2 的反控】不送新欄位 ⇒ 兩欄都**不存在**（否則 N2 的 0 可能是後端自己填的）",
          (pd1, pd2) == (False, False), f"實際 candidates_present={pd1} chosen_present={pd2}")

    pe1, _ = attr_n(rows["E"], "asrCandidates")
    pe2, _ = attr_n(rows["E"], "asrChosen")
    check("N5 負數視同沒送（不污染「有幾條」的分布）", (pe1, pe2) == (False, False),
          f"實際 candidates_present={pe1} chosen_present={pe2}")

    print("\n══ 讀取端：GET /admin/voice-corrections 的 pageEvents 四格 ══")
    code, resp = vc.req("GET", "/admin/voice-corrections", token=admin_tok)
    if code != 200 or not isinstance(resp, dict):
        fail_(f"N6 admin 正控沒回 200（{code}）—— 四格斷言未測到：{str(resp)[:200]}")
    else:
        pe = resp.get("pageEvents")
        if not isinstance(pe, dict):
            fail_(f"N6 回應沒有 pageEvents 物件：{str(resp)[:200]}")
        else:
            four = ["asrNoCandidateInfo", "asrSingleCandidate", "asrTopKept", "asrSwitched"]
            missing = [k for k in four if k not in pe]
            # 🔴 正控／反控成對：asrOk 在而四格缺 ⇒ 這是**舊版 lambda**（沒部署到），
            #    不是端點壞掉。兩種處置不同，所以訊息要分得出來。
            if not missing:
                pass_(f"N6 四格鍵齊全 ⇒ 新版 admin lambda 已上線（{ {k: pe[k] for k in four} }）")
            elif "asrOk" in pe:
                fail_(f"N6 pageEvents 認得 asrOk 但缺 {missing} ⇒ 線上跑的是**舊版** admin lambda")
            else:
                fail_(f"N6 pageEvents 連 asrOk 都沒有 ⇒ 不是版本問題，形狀整個不對：{str(pe)[:200]}")

            if not missing and "asrOk" in pe:
                s = sum(pe[k] for k in four)
                check(f"N7 四格加總 = asrOk（{s} vs {pe['asrOk']}）—— 互斥且窮盡",
                      s == pe["asrOk"], "不相等代表有一列落在四格之外")

    # ── 清理 ────────────────────────────────────────────────────
    print("\n── 清理 ──")
    left = vc.scan_mine(user_id)
    for it in left:
        rc, _, err = vc.ddb("delete-item", "--table-name", vc.TABLE, "--key",
                            json.dumps({"pk": it["pk"], "sk": it["sk"]}))
        if rc != 0:
            fail_(f"刪除失敗：{err.strip()[:160]}")
    after = vc.scan_mine(user_id)
    if after:
        fail_(f"仍有 {len(after)} 筆殘留")
    else:
        pass_(f"已清掉 {len(left)} 筆測試資料")

    # 帳號也要自己收（理由同 verify_voice_corrections.py：孤兒清掃那支認的是別的 MARK）。
    acct_left = 0
    for tbl in ("Users", "AuthIdentities", "AuthTokens"):
        rc, out, err = vc.ddb("scan", "--table-name", vc.PREFIX + tbl, "--output", "json")
        if rc != 0:
            fail_(f"清帳號時掃 {tbl} 失敗：{err.strip()[:160]}")
            continue
        d = json.loads(out)
        if d.get("LastEvaluatedKey"):
            fail_(f"{tbl} 未分頁完 —— 不宣稱已清乾淨")
            continue
        rc2, kout, _ = vc.ddb("describe-table", "--table-name", vc.PREFIX + tbl,
                              "--query", "Table.KeySchema[].AttributeName", "--output", "json")
        if rc2 != 0:
            fail_(f"取不到 {tbl} 的 key schema，不硬猜")
            continue
        kn = json.loads(kout)
        for it in d.get("Items", []):
            if user_id not in json.dumps(it, ensure_ascii=False):
                continue
            if not all(k in it for k in kn):
                continue
            rc3, _, err3 = vc.ddb("delete-item", "--table-name", vc.PREFIX + tbl,
                                  "--key", json.dumps({k: it[k] for k in kn}))
            if rc3 != 0:
                fail_(f"刪 {tbl} 失敗：{err3.strip()[:160]}")
                acct_left += 1
            else:
                print(f"  刪 {tbl}")
    if acct_left == 0:
        pass_(f"測試帳號 {user_id} 已清（Users / AuthIdentities / AuthTokens）")

    print(f"\n══ 斷言：通過 {TOTAL - FAIL} / 共 {TOTAL}（失敗 {FAIL}）══")
    print("══ 全部通過 ══" if FAIL == 0 else f"══ 有 {FAIL} 條失敗 ══")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()

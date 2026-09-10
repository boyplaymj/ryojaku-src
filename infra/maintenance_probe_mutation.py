#!/usr/bin/env python3
"""maintenance_public_routes_probe.sh 的突變測試。

用法：python3 infra/maintenance_probe_mutation.py
rc：0 = 每一發都被指名的那條測試殺掉；1 = 有存活或歸因不符；2 = 設備問題。

── 為什麼每一發都要「指名」 ────────────────────────────────────────────
「N 發全殺」是**規模**不是覆蓋 —— 它與「我最在意的那個宣稱一發都沒被打過」
在報表上逐字相同。所以每個 Mut 都帶 `expect`：**哪一條測試必須因為它變紅**。
只有那條紅了才算殺掉；別條紅了算「歸因不符」，一樣是失敗。

🔴 歸因用**精確比對**，不可以用 startswith —— 本自檢有 `E0`/`E0b`/`E0c`
   這種對子（`E0` 是 `E0b` 的前綴），前綴比對會把「被 E0b 殺掉」印成
   「被 E0 殺掉」，而那跟真的被 E0 殺掉逐字相同。

🔴 每輪先跑一次**未突變**的副本當基線。少了它，「沙盒壞掉導致每發都紅」
   會被整批算成「全殺」。

⚠️ 不突變 PROBE_LIB_ONLY 那道 guard：拿掉它，自檢就會去跑本尊的主流程，
   而主流程會**翻 stg 的維護開關**。那一發的代價不是一個紅燈。
"""
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROBE = ROOT / "infra" / "maintenance_public_routes_probe.sh"
SELFTEST = ROOT / "infra" / "maintenance_probe_selftest.sh"

# (代號, 說明, 原字串, 換成, 該紅的測試)
MUTS = [
    ("M1", "hdrs 不再印 Authorization",
     "  [ -n \"$auth\" ] && printf 'Authorization: Bearer %s\\n' \"$auth\"",
     "  [ -n \"$auth\" ] && true", "A3"),
    ("M2", "hdrs 無條件印 Content-Type（沒 body 也印）",
     "  [ -n \"$body\" ] && printf 'Content-Type: application/json\\n'",
     "  printf 'Content-Type: application/json\\n'", "A4"),
    ("M3", "hit 的 header 改回舊寫法（機密進 argv）",
     '      -H @<(hdrs "$auth" "$body") --data-binary @<(printf \'%s\' "$body"))',
     '      -H \'Content-Type: application/json\' -H "Authorization: Bearer $auth" '
     '--data-binary @<(printf \'%s\' "$body"))', "C2"),
    ("M4", "hit 的 body 改回 -d（密碼進 argv）",
     '--data-binary @<(printf \'%s\' "$body"))',
     '-d "$body")', "C2"),
    ("M5", "hit 改回 -o /dev/null（拿不到回應內容）",
     'code=$(curl -s -o "$BODYFILE" -D "$hdrfile" -w \'%{http_code}\' -X "$m" "$API$p" \\\n'
     '      -H @<(hdrs "$auth" "$body")',
     'code=$(curl -s -o /dev/null -D "$hdrfile" -w \'%{http_code}\' -X "$m" "$API$p" \\\n'
     '      -H @<(hdrs "$auth" "$body")', "B3"),
    ("M6", "user_exists 不處理「空字串＝不存在」",
     '  [ -z "${out//[[:space:]]/}" ] && return 1',
     '  true', "D2"),
    ("M7", "user_exists 永遠說不存在",
     '  return $?\n}', '  return 1\n}', "D1"),
    ("M8", "authtoken_hashes 的 filter 永遠不成立",
     "--filter-expression 'userId = :u'",
     "--filter-expression 'userId = :u AND attribute_not_exists(userId)'", "E0"),
    ("M9", "cleanup：read-back 說「仍在表上」時不記問題",
     '      0) problems+=("Users/$uid 仍在表上") ;;',
     '      0) : ;;', "F2"),
    ("M10", "cleanup：read-back「讀不出來」時當成乾淨",
     '      2) problems+=("Users/$uid read-back 讀不出來 ⇒ 不知道還在不在") ;;',
     '      2) : ;;', "F3"),
    ("M11", "cleanup：旗標沒還原時不記問題",
     '    problems+=("旗標沒還原乾淨，讀回 = $after —— 請手動 delete-item")',
     '    :', "F4"),
    ("M12", "cleanup：有問題時 rc 退回 1（不是 2）",
     '    say "  ⇒ rc=2：斷言另計，但這一輪**留下了東西** ⇒ 結果不可信。"\n    rc=2',
     '    say "  ⇒ rc=2：斷言另計，但這一輪**留下了東西** ⇒ 結果不可信。"\n    rc=1', "F2"),
]

FAIL_RE = re.compile(r"^\s*❌\s*([A-F]\d+[a-z]*)")


def reds(output: str):
    """印出來的紅燈 → 測試代號集合（**精確**代號，不是前綴）。"""
    out = set()
    for line in output.splitlines():
        m = FAIL_RE.match(line)
        if m:
            out.add(m.group(1))
    return out


def run_selftest():
    p = subprocess.run(["bash", str(SELFTEST)], cwd=str(ROOT),
                       capture_output=True, text=True, timeout=600)
    return p.returncode, p.stdout + p.stderr


def main():
    if not PROBE.exists() or not SELFTEST.exists():
        print("🔴 [設備] 找不到探針或自檢檔"); return 2

    backup = Path(tempfile.mkdtemp(prefix="mpmut-")) / PROBE.name
    shutil.copy2(PROBE, backup)
    original = PROBE.read_text(encoding="utf8")

    def restore(*_a):
        PROBE.write_text(original, encoding="utf8")

    # 被砍時也要還原 —— 共用工作樹上留下突變體，別條 session 會把它當成正式碼。
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *a: (restore(), sys.exit(2)))

    try:
        print("══ 基線：未突變的副本必須全綠 ══")
        rc, out = run_selftest()
        if rc != 0:
            print(out[-3000:])
            print(f"🔴 [設備] 基線就不是綠的（rc={rc}）⇒ 下面每一發的紅燈都不算數")
            return 2
        print(f"  ✅ 基線 rc=0（{len(reds(out))} 條紅燈）\n")

        killed, survived, misattributed = [], [], []
        for code, desc, old, new, expect in MUTS:
            if old not in original:
                print(f"  🔴 {code} 對不到原字串 ⇒ **這一發根本沒突變**"
                      f"（那與『被殺掉』在計數上逐字相同）：{desc}")
                misattributed.append((code, "對不到原字串"))
                continue
            if original.count(old) != 1:
                print(f"  🔴 {code} 原字串出現 {original.count(old)} 次，"
                      f"改哪一處不確定 ⇒ 不做這一發：{desc}")
                misattributed.append((code, "原字串不唯一"))
                continue
            PROBE.write_text(original.replace(old, new, 1), encoding="utf8")
            rc, out = run_selftest()
            got = reds(out)
            restore()
            if rc == 0:
                print(f"  ❌ {code} **存活**（自檢照樣全綠）：{desc}")
                survived.append((code, desc))
            elif expect in got:            # 🔴 精確比對，不是 startswith
                extra = sorted(got - {expect})
                note = f"（同時紅了 {extra}）" if extra else ""
                print(f"  ✅ {code} 被 {expect} 殺掉{note}：{desc}")
                killed.append(code)
            else:
                print(f"  ⚠️ {code} 紅了但**不是** {expect}，實際紅的是 {sorted(got) or '(沒有紅燈,rc=' + str(rc) + ')'}：{desc}")
                misattributed.append((code, f"期望 {expect}，實得 {sorted(got)}"))

        print(f"\n══ 突變結果：{len(killed)} 發被指名的那條殺掉／"
              f"{len(survived)} 發存活／{len(misattributed)} 發歸因不符 ══")
        for c, d in survived:
            print(f"  存活 {c}：{d}")
        for c, d in misattributed:
            print(f"  歸因不符 {c}：{d}")
        return 0 if not survived and not misattributed else 1
    finally:
        restore()
        shutil.copy2(backup, backup.with_suffix(".bak"))


if __name__ == "__main__":
    sys.exit(main())

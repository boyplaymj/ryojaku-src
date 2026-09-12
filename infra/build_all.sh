#!/usr/bin/env bash
# 編譯全部 Go Lambda → build/<art>/bootstrap (arm64, provided.al2023)。
# ⚠️ 這行原本寫死「61 顆」，2026-08-10 實跑是 75 顆 —— 手抄的數字不會報錯，但會誤導。
#    實際數量以結尾那行 `DONE ok=… fail=…` 為準（由程式自己數）。
# 產物給 02-app.generated.yaml 的 CodeUri 直接打包。先 go mod download all 暖快取。
set -uo pipefail
BACKEND=/opt/sml/ryojaku-src/backend
OUT=/opt/sml/ryojaku-src/build
cd "$BACKEND"

# 🔴 裸型別斷言棘輪（2026-09-12 接上）。
#    在此之前唯一會跑它的是 .github/workflows/backend-go.yml 的 `go test ./...`，
#    而那支自 2026-09-06 就沒被觸發過（本地 master 領先 origin/master 101 顆）
#    ⇒ 棘輪 09-11 出生至今，一次都沒有被自動跑過。
#    「設定裡有觸發點」與「它真的會跑」在 .github/ 的檔案上逐字相同 —— 這一行補的是後者。
#    擺在 build 之前：紅的時候 binary 就不會被建出來，也就不會被 sam deploy 帶上去。
#    真的必須寫裸斷言 → 加進 baseline.txt 並附理由；臨時放行 BAREASSERT_GATE_OFF=1。
if [ "${BAREASSERT_GATE_OFF:-0}" != "1" ]; then
  if ! go test -count=1 ./cmd/lambdas/bareassert/; then
    echo "BLOCKED 裸型別斷言棘輪不過 —— 沒有建任何 binary。"
    echo "  修法：改成 v, ok := x.(T) 並在 !ok 時 fail-closed。"
    echo "  真的必須寫：go test ./cmd/lambdas/bareassert -run TestBareAssertRatchet -update 並在該行留一句為什麼。"
    echo "  臨時放行：BAREASSERT_GATE_OFF=1 bash infra/build_all.sh"
    exit 3
  fi
else
  echo "WARN BAREASSERT_GATE_OFF=1 —— 棘輪這次沒跑。"
fi

go mod download all
ok=0; fail=0
while IFS= read -r m; do
  dir=$(dirname "$m")
  art=$(echo "$dir" | sed 's|^\./cmd/lambdas/||; s|/|__|g')
  mkdir -p "$OUT/$art"
  if GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc \
       -ldflags='-s -w' -o "$OUT/$art/bootstrap" "$dir"; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "FAIL $art"
  fi
done < <(find ./cmd/lambdas -name main.go | sort)
echo "DONE ok=$ok fail=$fail"

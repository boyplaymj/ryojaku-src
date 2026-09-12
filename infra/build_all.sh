#!/usr/bin/env bash
# 編譯全部 Go Lambda → build/<art>/bootstrap (arm64, provided.al2023)。
# ⚠️ 這行原本寫死「61 顆」，2026-08-10 實跑是 75 顆 —— 手抄的數字不會報錯，但會誤導。
#    實際數量以結尾那行 `DONE ok=… fail=…` 為準（由程式自己數）。
# 產物給 02-app.generated.yaml 的 CodeUri 直接打包。先 go mod download all 暖快取。
set -uo pipefail
BACKEND=/opt/sml/ryojaku-src/backend
OUT=/opt/sml/ryojaku-src/build
cd "$BACKEND"

# 🔴 裸型別斷言棘輪（2026-09-12 接上）。在此之前它只有 `go test ./cmd/lambdas/bareassert/`
#    這一個觸發點，而沒有人會去打 —— 「有測試」不等於「有接上」，那正是它要防的那種洞。
#    擺在 build 之前：紅的時候binary 就不會被建出來，也就不會被 sam deploy 帶上去。
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

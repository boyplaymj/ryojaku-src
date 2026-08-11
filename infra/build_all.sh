#!/usr/bin/env bash
# 編譯全部 Go Lambda → build/<art>/bootstrap (arm64, provided.al2023)。
# ⚠️ 這行原本寫死「61 顆」，2026-08-10 實跑是 75 顆 —— 手抄的數字不會報錯，但會誤導。
#    實際數量以結尾那行 `DONE ok=… fail=…` 為準（由程式自己數）。
# 產物給 02-app.generated.yaml 的 CodeUri 直接打包。先 go mod download all 暖快取。
set -uo pipefail
BACKEND=/opt/sml/ryojaku-src/backend
OUT=/opt/sml/ryojaku-src/build
cd "$BACKEND"
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

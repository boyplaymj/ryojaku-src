# 🔴 **這個檔目前沒有任何東西在讀它**（2026-09-09 實查，B1-c2d）。
#
# 原註解寫「由 gen 產。sam build 會呼叫 build-<LogicalId>」—— 兩半都不成立：
#   ① `gen_app_template.py` 完全沒有寫 Makefile 的程式碼（grep 零命中）
#   ② `02-app.generated.yaml` 裡 `BuildMethod` 出現 **0 次** ⇒ SAM 不會走 makefile
#      建置。CodeUri 直接指向 `../build/<art>/`，那些 bootstrap 是 `build_all.sh`
#      用 `find ./cmd/lambdas -name main.go` 掃出來編的。
#
# 徵兆為零的地方在這裡：它停在 61 個目標，而 manifest 早已 80+ 支 ——
# 若真的有人在讀它，缺 20 個目標的 build 會炸；它不炸，正因為沒人讀。
# 「檔案存在、內容看起來合理、從來沒被執行」與「有在用」在 repo 裡長得一樣。
#
# ⇒ 留著不刪，因為 `BuildMethod: makefile` 是 SAM 的正當路徑，未來可能切回去。
#   但**不要照它推論現在的建置方式** —— 現在的正典是 `build_all.sh`。

build-FnAdminActivities:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminAdmins:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminAnalysis:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminDashboardGetStats:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminLogin:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminLogs:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminModeration:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminPointHistory:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminPushAll:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminUsers:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminVersions:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAdminVouchers:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAnalytics:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAppLogin:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAppRegister:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAppVersionConfig:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatArchiver:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatGetHistory:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatGetRoomInfo:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatGetRooms:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatGetUploadUrl:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatMarkRead:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatWsConnect:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatWsDisconnect:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnChatWsSendMessage:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityAddComment:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityCreatePost:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityGetPostDetail:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityGetPosts:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityGetUploadUrl:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityGetUserPosts:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityLikeComment:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCommunityLikePost:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCreateGame:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnDailyBonus:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnEventCommands:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnGameDetail:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnGameRegister:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnGetRatings:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnEventGetUploadUrl:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnGetUploadUrl:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnLedger:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnMyGames:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnNotifications:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnRedeemCode:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnRedeemPoints:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnRejectRegistration:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnAcceptRegistration:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCancelGame:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnCancelRegistration:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnSearchGames:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnSubmitRating:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnSubscribePush:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnSubscriptionStatus:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnUnsubscribePush:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnClaimPushBonus:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnUserComments:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnUserInfo:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnUserProfile:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnVapidKey:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

build-FnVerifyUser:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags='-s -w' -o $(ARTIFACTS_DIR)/bootstrap .

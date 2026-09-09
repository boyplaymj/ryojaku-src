# `backend/scripts/` 是什麼

🔴 **這裡的 `setup_*.{sh,ps1}` 是接手自工程師的舊腳本，不是正典。**

它們留著的用途只有一個：**查既有表的 key schema／既有路由的形狀**（`infra/README.md`
明寫「Keys 取自工程師 setup_*.{sh,ps1} 建表腳本」—— 它們是**來源**，不是操作介面）。

## 要新增 DynamoDB 表 → 改 `infra/01-tables.yaml`

```bash
cd infra
# 1) 在 01-tables.yaml 加一個 <Name>Table 資源
aws cloudformation deploy --template-file 01-tables.yaml \
  --stack-name ryojaku-tables-stg --parameter-overrides TablePrefix=MahjongClubStg_ \
  --region ap-southeast-1
```

## 要新增 Lambda 或路由 → 改 `infra/functions.manifest.json`

改完跑 `python3 gen_app_template.py` 重生 `02-app.generated.yaml`（**勿手改生成檔**），
再 `sam build` + `sam deploy`。

## 為什麼要寫這一頁（2026-09-09）

做 `[B1-c2b]` 時我拿 `setup_points_table.sh` 當範本，寫了一支
`setup_venues_table.sh` 手建 `MahjongClubStg_Venues`。表建起來了、腳本冪等、
有反控、有測試 —— **而那張表不在 CloudFormation 管理下**。

徵兆是零的：`describe-table` 一切正常，lambda 也讀得到（IAM 對 `${prefix}*` 全域授權）。
唯一看得出來的是 `describe-stack-resources` 查不到它 —— 而那不是我當時會去做的檢查。

⚠️ 那張表當時 0 筆，所以訂正的代價只是「刪掉重建」。**有資料之後就不是了** ——
CloudFormation 沒辦法直接接管既有資源，要走 resource import 流程。

⇒ 判準：**動 AWS 資源之前先問「這個資源現在歸誰管」**，不是「有沒有現成的腳本可以抄」。
抄一段「已經在跑」的腳本，會把它的年代一起抄過來。

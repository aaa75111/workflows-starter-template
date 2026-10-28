# PR #22 獨立 v2 migration 驗收紀錄（2026-10-28）

已完成獨立私人 staging 的真實 v1→v2 migration，以及舊實例、應用快照、
引擎 journal 與 WebSocket 重連的前後比對。同一 artifact 的向前重部署已執行；
重部署後的保留比對與原等待實例繼續執行也通過。遠端部署來源固定為 `b58fefd`。
正式 migration、main 合併與正式應用部署未執行。下列時間以 Cloudflare 的
UTC 紀錄為準；台北時間為 UTC+8。

## 來源、版本與相依關係

| 項目 | 本輪核對版本／狀態 | 相依與界線 |
| --- | --- | --- |
| main | `51d36ce7b9d59da6e50c73407229467c3e4aeda1` | 包含 #17 的 undici／zod 修補；未合併下列 PR |
| #16 | `8f0d117ff480e9dec0a18b5d42cb7b73a6c70946`，Open，非 Draft | AV／generic 隔離、審核及前端重連；正式 v2 尚未套用 |
| #18 | `9f9aace4f12d06f6fe7b662a61ad629bec6dda15`，Open，非 Draft | 使用原 binding 的審核修補；沒有 v2 migration |
| #20 | `8f02f75aa86c63b4768631bf703e998dcfdcd39d`，Open、Draft | 以 #18 為 base，補歷史實例阻擋與終態保存 |
| #21 | `1f311c8adb65cc383f76fb0efd4d2de1ee648dad`，Open、Draft | 以 #16 分支為 base，保留 #18／#20 的快照格式與舊 RPC；尚未整合最新前端 |
| #22 本輪程式 | `b58fefd3fdff0404527b596c29553e53ee70fbb7`，Open、Draft | main 加 inert DO／binding／v2、帳號與來源防護；未啟用其他 PR 的應用修補 |

#18／#20 的 Cloudflare check 成功並產生版本，不等於正式流量已切換。
本輪讀到 #18 版本 `76e7d861-8e4c-403a-a908-217601574da7`、#20 版本
`5de25d4e-ca8c-40d9-a78f-f30664b73ad8`。#16 與 #22 的 production-target
Cloudflare checks 仍失敗。#22 `b58fefd` 的失敗 build 為
`2d4a3a9a-c3a5-4821-9d80-5d89d5d0cc34`；本輪未讀取該 build 的完整日誌，
不把舊日誌視為這次失敗的完整原因。

正式只讀盤點確認 active deployment `e7c3a591-e5e9-4320-9151-f7d42f83893e`、
版本 `5a3defac-dbae-4b5d-a925-4c2045c81afc` 100%，runtime migration tag `v1`。
原 `WorkflowStatusDO` namespace 仍是 `564deb0be97b4570b2ae903007f04f0f`，
SQLite 後端；原 Workflow binding 為 `SHION_WORKFLOW → shion-av-content-pipeline`。
正式版本沒有足以獨立證明 source SHA 的 commit annotation；main 對應關係保留原紀錄，
本輪另外直接確認上述 runtime 版本、流量、bindings 與 migration tag。

因此正式 v2 的前置條件仍未完成。若 main 或 live 先納入 #18／#20，必須重建
bootstrap baseline 並重新驗收；禁止把本輪舊應用 bundle 部署回已修補的 live。
#21 是後續 #16 整合的相容性工作，不會因 #22 provisioning 自動完成。

## 程式檢查與必要修補

- `worker/index.ts` 相對 pinned main 只新增 `AvWorkflowStatusDO` export；原 handler、
  `worker/workflow.ts`、`worker/durable-object.ts`、UI、依賴及 lockfile 的受保護 hash 通過。
- v1 未改寫，v2 僅 `new_sqlite_classes: ["AvWorkflowStatusDO"]`；沒有刪除、改名、
  transfer 或共享 namespace。新 class 的 fetch 回傳 503，不讀寫 storage。
- 補固定帳號、full source SHA、乾淨工作樹、origin/main 基底、建置前後來源一致性、
  alternate lifecycle／外部 binding／override 拒絕檢查。manifest 包含來源 commit／tree、
  Node、帳號、基底、時間及逐檔 SHA-256。
- 新增 `prepare-bootstrap-fixture.mjs`：從 Git 取固定 main 的原 handler／Workflow／DO，
  檢查 source hash，僅打包私人 v1 fixture 並 dry-run；不包含 UI、不會遠端部署。

Linux Node 24.22.1 與 MSI Windows Node 24.20.0 均以鎖定依賴驗證：audit 0、lint、
TypeScript／Vite、6/6 Workers、25/25 bootstrap guards、production／staging dry-run、
v1 fixture dry-run 通過。實際 CLI 亦拒絕未提交工作樹與縮寫 SHA。
GitHub Actions [40713920192](https://github.com/aaa75111/workflows-starter-template/actions/runs/40713920192)
在 `b58fefd` 成功。這些結果不代表 remote migration 或正式驗收通過。

Linux dry-run artifact-set hash：production
`1055158d6d644a6abac572d178851c23b644424f1d22c39fac7bebec45223066`；staging
`e94cf8ba76824c30449f73f4d5e58bf92f9b06dc925228bd8fbb1df193978be1`。
不同機器及建置路徑會影響產物；正式授權仍須重新選定 source、完整 bytes 與新 manifest。

## 私人 staging 的實際進度

MSI 新版 Wrangler 4.152.0 以既有 OAuth 成功確認帳號
`9bf1848f94dd5acd6989dfb705adba37`。沒有擴增 scopes、讀取瀏覽器憑證或外傳 CLI token。
操作使用獨立 checkout，未改動原工作目錄的未提交變更。

部署前 API 盤點顯示 bootstrap Worker／Workflow／namespace 均不存在。
已部署獨立 v1 fixture：

| 項目 | 實際值 |
| --- | --- |
| Worker | `workflows-starter-template-bootstrap-staging` |
| Workflow | `shion-av-bootstrap-staging` |
| v1 Worker version | `48d192bc-6f4a-4919-8df8-8fc33e8db4bd` |
| v2 Worker version | `cac7c7f2-aa40-4108-9801-9e869872e49c`，API 確認 migration tag `v2` |
| 向前重部署 version | `f101f5dd-00af-4b61-8c87-d6d9b552bc11` |
| v1 Workflow engine version | `c3a71ef0-18c4-41b2-88ec-479bfedad5a3` |
| 原 staging namespace | `acb9bbee15b940ce9ba07f616cffae07`，v1→v2 UUID 不變 |
| 新 AV namespace | `1c39eb4002604d6589bddcf4a37d3031`，與正式及其他 staging 獨立 |
| v2 artifact-set hash（MSI） | `4df93fb871c22c3b08dc464950b5bf217abae0e2c6e62e786c1d31a613084142` |
| v1 fixture artifact hash（MSI） | `814646095664cd56b4663e85c963f2de2ef33b6e9470bfe1ef0f29a423eba859` |
| 對外入口 | API 確認 routes `[]`、workers.dev `false`、previews `false` |

#16 既有 `workflows-starter-template-staging` 未套用此 fixture；其原 namespace
`fb67d9436d644c1494c4ea4203edab00` 與 AV namespace
`97d40d9d500d4ebaa7588732c28f6e35` 在盤點中仍獨立存在。

本輪只對兩個新建的 disposable v1 實例操作：
`510a0b64-4a4e-4155-b17f-7db3cec86599` 已透過原 HTTP 入口送出布林 true，
引擎 journal 確認 4 步完成；`678b20bb-ebe0-4904-a1a3-55e577360767` 在 migration
與向前重部署複驗期間保留等待審核，兩次比對通過後才對此測試 ID 送出 true，
確認原 HTTP／引擎／WebSocket 仍可完成原來 4 個步驟。這些媒體步驟仍是模擬。
未向正式或既有使用者歷史實例發送事件，沒有刪除、重啟或自動核准舊實例。

早期盤點的未完成 waitForEvent 曾回報 `running`；正式升級前基線的引擎狀態
已是 `waiting`，DO 審核步驟為 `waiting`、發布為 `pending`。應同時比對未完成
waitForEvent 的 journal 與應用快照，不能只依一次 enum 判定。60 分鐘原 timeout
未縮短，這不是自然逾時驗收。

升級前基線於 `2026-10-28T15:42:09.089Z` 保存；v2 後比對於
`2026-10-28T15:49:39.101Z` 保存並通過。已確認：

- 原 namespace UUID 保持不變，新 AV namespace 獨立建立。
- 兩個舊實例的原 engine version `c3a71ef0-18c4-41b2-88ec-479bfedad5a3`、狀態、
  參數與完整 journal 比對相同；等待中的舊實例仍沒有 publish checkpoint。
- 同一 instanceId 的 RPC 與重新連線 WebSocket 應用快照相同；只排除快照的讀取時間戳。
  本輪沒有宣稱持續保持的單一 WebSocket 連線全程零中斷。
- 正式唯一物件的應用快照在私人 migration 前後相同；這不是完整 SQLite／PITR 備份。

| 應用快照 | canonical SHA-256（排除讀取時間戳） |
| --- | --- |
| 正式原物件 | `ff7a2012374d891da02847ef28ce823fdd16a2381ad9f0b71939db82807f6448` |
| v1 已完成實例 | `bfe38767e86c67c22d4e67ffcd2e89ef8fc7813827dccb7a9959b641ed272da4` |
| v1 等待審核實例 | `a8e1ede4725fff848b4460b4957c0a0595600d13056cd7bea8865d3f7749da35` |

以上 hash 只描述本輪 canonical 應用快照，不能與不同序列化方式的舊備份 hash 直接互換。
完整 journal 的比對保留原始時間戳、參數及步驟輸出。讀取曾發生連線逾時與
Cloudflare preview ProxyWorker internal error；失敗收集未列為通過，成功證據另行保存。

## 證據與續作

原始快照、CLI／API JSON、journal、fixture 與收集程式留在 MSI 的私人證據目錄：
`C:\AI_Workbase\backups\pr22-bootstrap-20261028`。
已產生 `acceptance-summary.json`，完整交叉核對通過；其 UTC 時間為
`2026-10-28T16:02:12.668Z`。逐檔證據索引 `evidence-index.json` 的 SHA-256 為
`545f9cf3120f556b5e33efa658194cc763ec54e9ead67812f66eb0f444b5f590`。
實際部署的 staging bytes 與 matching manifest 亦已保留。

最後核對確認向前重部署後兩個 namespace 與 script etag 均未改變，舊等待實例
仍用原 engine version 完成、原參數與前兩個步驟輸出保留。正式 deployment、
100% 流量、v1 tag、原 namespace 及應用快照均未改變；私人入口仍全部關閉。

原始應用資料及憑證未提交公開 repo。正式 namespace 物件清單本輪仍為 1 個、
下一 cursor 頁為空；這只是物件盤點，不是完整資料庫或 Workflow 引擎備份。

| 驗收項目 | 目前判定 |
| --- | --- |
| 靜態最小變更與本機回歸 | 通過 |
| 固定來源／帳號、私人 v1 fixture、遠端私人入口設定 | 通過 |
| v1 升級前應用快照與完整 journal 基線 | 通過 |
| 真實 v1→v2 migration、原 namespace UUID 不變 | 通過 |
| 舊實例／已讀應用快照／WebSocket 重連前後相容 | 通過；不代表完整資料庫／PITR 驗收 |
| 保留 v1／v2 的相容 artifact 向前重部署與資料複驗 | 通過；未模擬資料庫毀損或 PITR 還原 |
| 舊等待實例在 v2／重部署後繼續執行 | 通過，原 engine version 與前兩步輸出保留 |
| 後續完整 #16／#21 AV 整合與自然逾時 | 尚未驗收 |
| 正式 v2、#16 versions upload、main 合併／正式部署 | 尚未執行 |

續作須先重新讀取 live／main、私人 target 與既存測試 ID。此私人 target 已是 v2。
禁止再次套用 v1 fixture，也不要以重新建立 namespace 取代保留資料的演練。
後續依 [執行手冊](av-v2-bootstrap.md) 檢查 exact source 的 staging artifact，
清除 `CLOUDFLARE_ENV` 後才對驗證過的 emitted config 執行後續私人相容性測試。

## 回復與正式放行

原 DO class／binding／namespace 與 v1 全程保留；v2 僅新增 inert namespace。
進入 v2 後的修復 artifact 必須保留兩個 exports／bindings 及 v1／v2 歷史，
用重新部署相容程式向前修復。Cloudflare
[rollback 限制](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
不允許跨越 DO lifecycle change 回到先前版本；舊 version ID 本身不是完整回復方案。
應用 JSON 快照也不是 SQLite／PITR 或 Workflow engine journal 的完整備份。

本輪最小 bootstrap 的私人 migration、已讀應用快照、舊實例、WebSocket 重連與
相容 artifact 向前重部署已通過；完整 AV 相容性與完整備份還原仍未驗收。
正式部署仍需重新盤點、刷新備份與 artifact，並取得指定帳號、正式 Worker、來源 SHA、
artifact hash 與窗口的正式授權。PR #22 保持 Draft，不合併 main、不把 CI 成功當部署授權。

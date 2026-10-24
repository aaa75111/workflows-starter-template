# 2026-10-24 相依套件安全修補

## 基準與共同來源

儲存庫：`aaa75111/workflows-starter-template`。
基準 main：`45777dd19958121cfa9119337db1e52a1ac36222`。
[失敗的 GitHub Actions #40045298537](https://github.com/aaa75111/workflows-starter-template/actions/runs/40045298537)
完成 npm ci 後，在 `npm audit --audit-level=low` 回傳 exit code 1；後續 verify 被跳過。

重新安裝基準 lockfile 並執行稽核，重現 6 項受影響套件紀錄：3 moderate、3 high。
這不是 6 個互不相干的根因：4 份安全公告集中在 undici 和 zod，再沿相依關係影響其他套件。

| 受影響套件 | 稽核嚴重度 | 相依來源 |
| --- | --- | --- |
| undici | high | 三份 miniflare 安裝共用 7.29.1 |
| zod | high | vitest-plugin 固定 4.6.5；react-hooks / zod-validation-error 也共用此版本 |
| miniflare | moderate | 依賴 undici |
| wrangler | moderate | 依賴 miniflare |
| @cloudflare/vite-plugin | moderate | 依賴 miniflare / wrangler |
| @cloudflare/vitest-plugin | high | 依賴 miniflare / wrangler / zod |

## 最小修補

| 套件 | 修補前 | 修補後 |
| --- | --- | --- |
| undici | 7.29.1 | 7.30.1 |
| zod | 4.6.5 | 4.6.6 |
| wrangler（直接相依） | 4.152.0 | 4.152.0 |
| @cloudflare/vite-plugin | 1.64.0 | 1.64.0 |
| @cloudflare/vitest-plugin | 1.4.4 | 1.4.4 |
| vitest | 5.0.5 | 5.0.5 |

`overrides.miniflare.undici` 僅覆寫 miniflare 使用的 undici。
`overrides.zod` 固定所有現有共用路徑至 4.6.6；react-hooks 與 zod-validation-error 的 peer 範圍包含此版本。
兩者均保留原本的 major。lockfile 由 npm 產生，只變更兩個套件的版本、下載位置和完整性雜湊。
沒有執行 `npm audit fix --force`、`--legacy-peer-deps`，也沒有降低稽核門檻。

上游公告與修補門檻：

- [undici EventSource 記憶體耗盡](https://github.com/advisories/GHSA-4qv8-2p9j-2685)：7.30.1。
- [undici SRI 大小寫驗證](https://github.com/advisories/GHSA-f72v-6w45-q472)：7.30.1。
- [undici Content-Encoding 錯誤處理](https://github.com/advisories/GHSA-xjj6-f33q-929c)：7.30.1。
- [zod 集合驗證記憶體耗盡](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)：4.6.6。

## 本機驗證

環境：Linux、Node.js 24.19.0、npm 11.9.0。

| 檢查 | 基準 | 修補後 |
| --- | --- | --- |
| `npm ci --progress=false` | exit 0 | exit 0 |
| `npm audit --audit-level=low --json` | exit 1；6 項 | exit 0；0 項 |
| `npm run verify` | exit 0；2/2 tests | exit 0；4/4 tests |
| `npm ls undici zod miniflare wrangler @cloudflare/vite-plugin @cloudflare/vitest-plugin --all` | 有問題的共用版本 | 無 peer / invalid 錯誤，只有修補後版本 |
| Worker JS、產生的 Wrangler 設定、前端 JS / CSS 的 SHA-256 | 基準 | 逐檔相同 |

verify 包含 ESLint、TypeScript、Vite、真實本機 Workers runtime 測試與 Wrangler dry-run。
dry-run 保留 `SHION_WORKFLOW / ShionPipelineWorkflow`、`WORKFLOW_STATUS / WorkflowStatusDO`。
原有成功／逾時測試保留，另外兩項相容性測試涵蓋：

1. HTTP editorial-approval 路由送達 Workflow binding，四階段完成，HTTP status 與 WebSocket 完成狀態一致。
2. Durable Object RPC 更新會即時廣播，狀態確實寫入 storage，eviction 後重新連線仍取得相同快照。

逾時案例使用測試 API 強制逾時，會輸出預期的 WorkflowTimeoutError；不是實際等待 60 分鐘。
GitHub Actions 與 Cloudflare 的最終提交結果以本修補 PR 的 Checks 和合併後 main 執行紀錄為準。

## 後續維護與界線

- 當上游 miniflare / vitest-plugin 不再固定漏洞版本時，可移除相應 override，再重新產生 lockfile、乾淨安裝、稽核和 verify。避免永久固定而錯過後續修補。
- 本次不變更 Worker 原始碼、bindings、DO migration 或影音邏輯。main 原有的 `approved` 值未驗證問題仍由 [PR #16](https://github.com/aaa75111/workflows-starter-template/pull/16) 處理；該 PR 的舊 Workflow 相容與遷移驗收亦是獨立工作。
- 影音匯入、轉檔、發布仍為模擬；本機測試與 dry-run 不代表真實影音發布或正式環境遷移已驗收。
- npm 仍提示 ESLint 9.39.2 已停止支援，屬後續工具鏈維護；這次沒有做非必要的 ESLint major 升級。
- 稽核 0 項代表執行當時 npm 公告資料庫的結果，並非所有應用層風險均已消除。

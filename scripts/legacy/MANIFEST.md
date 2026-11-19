# Legacy Scripts Manifest (`scripts/legacy/`)

Các script one-off dùng trong giai đoạn khảo sát ban đầu đã được chuyển vào `scripts/legacy/` (các file `.mjs` trong thư mục này được gitignore cục bộ) để giữ lịch sử đối chiếu mà không làm rối danh mục script đang vận hành. **Không chỉnh sửa hay xóa dữ liệu cục bộ**; cân nhắc kỹ trước khi chạy lại vì các ràng buộc bên dưới.

| Script *(local-only, gitignored)* | Đường dẫn cũ | Mục đích ban đầu | Ràng buộc / Rủi ro | Thay thế chuẩn hiện tại |
| --- | --- | --- | --- | --- |
| `crawl-readonly.mjs` | `scripts/crawl-readonly.mjs` | Crawl read-only 35 routes HTML, tải `openapi.json`, test Bearer vs Cookie qua Chrome CDP | Import từ thư mục sibling bên ngoài workspace (`.agents/skills/browse-open/scripts/core.mjs`); hardcode `outDir` | [src/collector.mjs](../../src/collector.mjs) (`mis_collect_account_data`) + `reports/openapi.json` |
| `extract-bearer-and-user.mjs` | `scripts/extract-bearer-and-user.mjs` | Đọc cookie `access_token` qua CDP ghi `.env.mis` và probe `/api/v1/auth/me` | Import từ thư mục sibling bên ngoài; **ghi đè `.gitignore` chỉ còn 3 dòng** (sẽ làm mất rule bảo vệ dữ liệu riêng tư) | [src/cdp-auth.mjs](../../src/cdp-auth.mjs) (`mis_refresh_token_from_cdp`) |
| `extract-scripts-and-auth.mjs` | `scripts/extract-scripts-and-auth.mjs` | Trích inline scripts, event handlers, meta cookies từ DOM trang project qua CDP | Import từ thư mục sibling bên ngoài; hardcode `outDir` | Dữ liệu cục bộ tại `reports/project-inline-scripts.js` và `reports/cookies-meta.json` |
| `inspect-mis.mjs` | `scripts/inspect-mis.mjs` | Snapshot DOM, buttons, controls, navs trang MIS qua CDP | Import từ thư mục sibling bên ngoài | Dữ liệu cục bộ tại `reports/project-page-snapshot.json` |

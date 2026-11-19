# `mis_matrix` — Matrix AI EDU Specific Agent & MCP Server

Workspace Specific AI Agent độc lập và MCP server chuẩn stdio (Node.js `>= 22`, zero npm dependencies) cho **Matrix AI EDU** (`https://mis.oanhcuongdo.com`).

## Kiến trúc Workspace

Xem chi tiết sơ đồ thư mục và quy chuẩn tại [AGENTS.md](AGENTS.md) và [docs/WORKSPACE_STRUCTURE.md](docs/WORKSPACE_STRUCTURE.md):

- `AGENTS.md` — Always-on handbook (`poteto-mode`: playbook routing + `figure-it-out` fallback + safety/evidence gates).
- `.agents/playbooks/` & `.agents/skills/` — Quy trình chuẩn (`collect-account-data`, `investigation`, `onboarding-auth`, `verify-and-evidence`, `session-pickup`, `pause-safely`) và năng lực tái sử dụng (`mis-account-collector`, `mis-project-ops`, `verify-evidence`).
- `context/` — `PROFILE.md`, `STATE.md`, `DECISIONS.md`, `domain-overview.md`, `directory.md` và `handoffs/` *(gitignored; chỉ cập nhật theo yêu cầu người dùng)*.
- `src/` — Mã nguồn MCP server `mis_matrix` (`48` tools: `30` read-only, `18` write/action).
- `scripts/` — Tiện ích tạo tài liệu (`README.md`) và lưu trữ có kiểm soát `scripts/legacy/` (`scripts/legacy/MANIFEST.md`).
- `docs/`, `reports/`, `exports/`, `records/`, `tests/` — Tài liệu OpenAPI/UI, snapshot khảo sát, dữ liệu export theo account, decision log và bộ test.

## Cấu hình xác thực

Sao chép [.env.example](.env.example) thành `.env.mis` (hoặc cấu hình biến môi trường):

- `MIS_BASE_URL` (mặc định `https://mis.oanhcuongdo.com`)
- `MIS_BEARER_TOKEN` (JWT từ cookie `access_token` của phiên user; có thể lấy qua `mis_refresh_token_from_cdp`)
- `MIS_CDP_ENDPOINT` (tùy chọn, mặc định `http://127.0.0.1:63725`)
- `MIS_READ_ONLY` (tùy chọn: đặt `1` / `true` để chặn mọi request không phải `GET` ở tầng client)
- `MIS_EXPORTS_DIR` (tùy chọn, mặc định `exports/` trong workspace cho `mis_collect_account_data` và `mis_get_user_logs`)

## Thu thập full data theo account & truy xuất user logs (Chỉ đọc `GET`-only)

- **`mis_collect_account_data`**: Thu thập toàn bộ dữ liệu tài khoản đang đăng nhập (`auth/me`, `auth/tlu/status`, tất cả `projects`, `members`, `tasks` kèm `checklists`/`comments`/`reports`, `documents`, `feed`, `performance`, và `courses`/`assignments` nếu có) rồi lưu thành các file JSON có cấu trúc trong `exports/acc-<user>-<timestamp>/` (`manifest.json`, `account.json`, `projects/*.json`, `user-timeline.json`, `full-snapshot.json`) và `exports/latest-manifest.json`.
- **`mis_get_user_logs`**: Truy xuất timeline & full log (comment trao đổi thủ công, system log, báo cáo, checklist đã hoàn thành, project feed) theo `user_id` hoặc `email` (mặc định là account hiện tại) từ API live hoặc lọc offline từ `snapshot_path`.

## Đăng ký vào Antigravity MCP

```powershell
agy mcp add mis_matrix -- node "<path-to-repo>/src/mcp-server.mjs"
```

Nếu muốn chạy ở chế độ chỉ đọc tuyệt đối:

```powershell
agy mcp add mis_matrix --env MIS_READ_ONLY=1 -- node "<path-to-repo>/src/mcp-server.mjs"
```

## Chạy kiểm thử

- **Tất cả unit & workspace contract tests (mock local + kiểm tra cấu trúc, không chạm web thật):**
  ```powershell
  npm test
  ```
- **Chạy riêng từng bộ test local:**
  ```powershell
  npm run test:mcp
  npm run test:contract
  ```
- **Live read-only verification (`GET`-only, `MIS_READ_ONLY` enforced trên `mis.oanhcuongdo.com`):**
  ```powershell
  npm run test:live-readonly
  ```

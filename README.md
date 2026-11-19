# `mis_matrix` — Matrix AI EDU Specific Agent & MCP Server

Workspace Specific AI Agent độc lập và MCP server chuẩn stdio (Node.js `>= 22`, zero npm dependencies) cho **Matrix AI EDU** (`https://mis.oanhcuongdo.com`).

## Kiến trúc Workspace

Xem chi tiết sơ đồ thư mục và quy chuẩn tại [AGENTS.md](AGENTS.md) và [docs/WORKSPACE_STRUCTURE.md](docs/WORKSPACE_STRUCTURE.md):

- `AGENTS.md` — Always-on handbook (`poteto-mode`: playbook routing + `figure-it-out` fallback + safety/evidence gates).
- `setup.mjs` & `src/onboarding.mjs` — Entrypoint cài đặt 1 lệnh (`node setup.mjs`), bắt buộc dùng `/browse-open` khi cần mở Native Chrome xác thực, tự khởi tạo `context/` & `.env.mis` an toàn, tự merge `mis_matrix` vào `~/.gemini/config/mcp_config.json` (bảo toàn các MCP khác) và chạy read-only smoke test.
- `.agents/playbooks/` & `.agents/skills/` — Quy trình chuẩn (`collect-account-data`, `investigation`, `onboarding-auth`, `verify-and-evidence`, `session-pickup`, `pause-safely`) và năng lực tái sử dụng (`mis-account-collector`, `mis-project-ops`, `verify-evidence`).
- `context/` — `PROFILE.md`, `STATE.md`, `DECISIONS.md`, `domain-overview.md`, `directory.md` và `handoffs/` *(gitignored; chỉ cập nhật theo yêu cầu người dùng)*.
- `src/` — Mã nguồn MCP server `mis_matrix` (`48` tools: `30` read-only, `18` write/action).
- `scripts/` — Tiện ích tạo tài liệu ([scripts/README.md](scripts/README.md)) và lưu trữ có kiểm soát `scripts/legacy/` ([scripts/legacy/MANIFEST.md](scripts/legacy/MANIFEST.md)).
- `docs/`, `reports/`, `exports/`, `records/`, `tests/` — Tài liệu OpenAPI/UI, snapshot khảo sát, dữ liệu export theo account, decision log và bộ test.

---

## Yêu cầu tiên quyết

- **Node.js `>= 22`** và **Git**
- **Native Google Chrome**
- **Skill bắt buộc — [`browse-open`](https://github.com/ntai0404/browse-open):** cơ chế duy nhất được phép dùng để mở Native Chrome khi đăng nhập Matrix AI EDU lần đầu hoặc `--reauth`. `setup.mjs` **không** fallback sang Playwright Chrome và sẽ dừng với mã lỗi `2` (`MISSING_DEPENDENCY: browse-open`) nếu chưa cài.
- **Antigravity IDE** (được `setup.mjs` tự cấu hình `mcp_config.json`) hoặc MCP client khác.

---

## Quick Start (`Clone -> Install /browse-open -> node setup.mjs -> Use`)

### 1. Clone repo và chạy setup tự động

```powershell
git clone https://github.com/ntai0404/mis.oanhcuongdo-intergartion.git
cd mis.oanhcuongdo-intergartion
node setup.mjs
```

`node setup.mjs` thực hiện tự động 5 bước (idempotent — chạy lại không ghi đè `.env.mis` hay `context/` đã tùy biến):
1. Kiểm tra Node.js `>= 22` và dependency bắt buộc `/browse-open` (`https://github.com/ntai0404/browse-open`). Nếu máy chưa có `/browse-open`, `setup.mjs` tự `git clone` vào `.agents/skills/browse-open` và đăng ký `browse_open` vào `mcp_config.json` (dùng `--skip-install` để tắt auto-clone và fail cứng với exit code `2` `MISSING_DEPENDENCY`). **Không bao giờ fallback sang Playwright Chrome.**
2. Tự tạo các thư mục cục bộ gitignored (`context/handoffs/`, `records/`, `exports/`, `downloads/`, `reports/`), starter templates (nếu chưa tồn tại) và `.env.mis` từ [.env.example](.env.example).
3. Kiểm tra `MIS_BEARER_TOKEN` trong `.env.mis`. Nếu chưa có hoặc hết hạn, phối hợp qua `/browse-open` để tái sử dụng hoặc mở Native Chrome tới `https://mis.oanhcuongdo.com/projects/` cho bạn đăng nhập 1 lần rồi đọc cookie `access_token` qua CDP (exit `3` `BROWSE_OPEN_ACTION_REQUIRED` nếu `/browse-open` cần bạn chọn profile/port tương tác).
4. Tự merge entry `mis_matrix` vào `~/.gemini/config/mcp_config.json` (bảo toàn nguyên vẹn `browse_open`, `webex_web` và các MCP khác).
5. Chạy live **read-only** stdio smoke test với `MIS_READ_ONLY=1` (`mis_health`, `mis_get_me`, `mis_list_projects` và xác minh `mis_create_task` bị chặn bởi `READ_ONLY_MODE`).

### 3. Reload IDE và sử dụng

Mở thư mục vừa clone trong Antigravity IDE (reload/restart IDE nếu đang mở sẵn) để nạp `AGENTS.md`, `.agents/` và MCP `mis_matrix`.

### Các cờ tùy chọn của `node setup.mjs`

| Lệnh | Mục đích |
| --- | --- |
| `node setup.mjs --reauth` | Làm mới `MIS_BEARER_TOKEN` qua `/browse-open` Native Chrome CDP |
| `node setup.mjs --cdp-url http://127.0.0.1:4444` | Tái sử dụng phiên Native Chrome CDP đã mở sẵn qua `/browse-open` |
| `node setup.mjs --read-only` | Cấu hình `mis_matrix` trong `mcp_config.json` kèm `MIS_READ_ONLY=1` |
| `node setup.mjs --browse-open-dir <path>` | Chỉ định tường minh thư mục skill `browse-open` |
| `node setup.mjs --mcp-config <path>` | Ghi cấu hình `mis_matrix` vào file `mcp_config.json` tùy chọn |
| `node setup.mjs --skip-login` | Bỏ qua bước mở Chrome CDP (chỉ tạo workspace, cấu hình MCP & smoke test bằng token sẵn có) |
| `node setup.mjs --skip-smoke` | Bỏ qua bước live read-only smoke test |

*(Nếu muốn đăng ký thủ công thay vì `node setup.mjs`: `agy mcp add mis_matrix -- node "<path-to-repo>/src/mcp-server.mjs"` hoặc thêm `--env MIS_READ_ONLY=1`.)*

---

## Biến môi trường (`.env.mis`)

Xem mẫu tại [.env.example](.env.example):
- `MIS_BASE_URL` (mặc định `https://mis.oanhcuongdo.com`)
- `MIS_BEARER_TOKEN` (JWT từ cookie `access_token`, được `setup.mjs` / `mis_refresh_token_from_cdp` ghi tự động)
- `MIS_CDP_ENDPOINT` (tùy chọn, mặc định `http://127.0.0.1:4444`)
- `MIS_READ_ONLY` (tùy chọn: `1` / `true` để chặn mọi request không phải `GET` ở tầng client)
- `MIS_EXPORTS_DIR` (tùy chọn, mặc định `exports/` cho `mis_collect_account_data` và `mis_get_user_logs`)

## Chạy kiểm thử

```powershell
npm test                  # Tất cả unit, contract & onboarding tests (mock local, không chạm web thật)
npm run test:mcp          # Chỉ MCP tool/client tests
npm run test:contract     # Chỉ workspace contract tests
npm run test:onboarding   # Chỉ onboarding/setup idempotency & /browse-open tests
npm run test:live-readonly # Live GET-only verification (MIS_READ_ONLY enforced trên mis.oanhcuongdo.com)
```

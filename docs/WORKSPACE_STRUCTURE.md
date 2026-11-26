# Workspace Structure & Architecture Guide (`MIS-matrix`)

- **Updated:** `2026-11-26 +07:00`
- **Root:** `<workspace-root>`
- **Template Reference:** [`docs/SPECIFIC_AGENT_TEMPLATE.md`](SPECIFIC_AGENT_TEMPLATE.md)

Tài liệu mô tả luồng điều phối, cây thư mục chuẩn Specific Agent của workspace `MIS-matrix` (đồng bộ theo chuẩn kiến trúc `webex-agent`), bảng mapping trước/sau tái cấu trúc và các bất biến an toàn.

---

## 1. Orchestration Flow

```text
AGENTS.md (always-on rules, safety gates, poteto-mode playbook router)
  ├──► context/ (PROFILE, STATE, DECISIONS, domain-overview, directory, handoffs/)
  ├──► .agents/skills/ (mis-account-collector, mis-project-ops, verify-evidence)
  ├──► .agents/playbooks/ (checkin, collect-account-data, investigation, onboarding-auth, verify-and-evidence, session-pickup, pause-safely)
  ├──► src/mcp-server.mjs (49-tool MCP router: 31 read-only, 18 write) ──► src/auth-manager.mjs + src/client.mjs + src/data-access.mjs + src/collector.mjs + src/cdp-auth.mjs
  └──► records/ (decisions.tsv) + exports/ + reports/ + tests/
```

- **`.agents/agents/` intentionally omitted:** Không tạo thư mục/file subagent placeholder khi chưa có workflow multi-agent thực tế sử dụng (được kiểm tra tự động bởi [`tests/workspace-contract.test.mjs`](../tests/workspace-contract.test.mjs)).

---

## 2. Cây thư mục chuẩn

```text
MIS-matrix/
├── AGENTS.md                        # Always-on contract: dispatch poteto-mode, playbooks/skills, guardrails
├── README.md                        # Hướng dẫn cài đặt 1 lệnh, đăng ký MCP và chạy kiểm thử
├── setup.mjs                        # Entrypoint onboarding 1 lệnh (bắt buộc /browse-open, cấu hình MCP, smoke test)
├── package.json                     # Entrypoint mis_matrix MCP & scripts (setup, test, test:mcp, test:contract, test:onboarding, test:auth, test:live-readonly)
├── .env.example                     # Mẫu cấu hình môi trường (không chứa secret thật)
├── .env.mis                         # [gitignored, local-only] MIS_BASE_URL & MIS_BEARER_TOKEN thực tế
├── .gitignore                       # Bỏ qua .env, .env.* (!.env.example), secrets/, context/, records/, reports/, exports/, downloads/, .local/, scripts/legacy/*.mjs, .agents/skills/browse-open/
│
├── .agents/                         # Lớp điều phối & năng lực Specific Agent
│   ├── playbooks/                   # 7 quy trình tác nghiệp chuẩn
│   │   ├── checkin.md
│   │   ├── collect-account-data.md
│   │   ├── investigation.md
│   │   ├── onboarding-auth.md
│   │   ├── verify-and-evidence.md
│   │   ├── session-pickup.md
│   │   └── pause-safely.md
│   └── skills/                      # 3 composable skills (auto-discover SKILL.md)
│       ├── mis-account-collector/SKILL.md
│       ├── mis-project-ops/SKILL.md
│       └── verify-evidence/SKILL.md
│
├── context/                         # [gitignored] Personal Context & handoff (chỉ cập nhật theo yêu cầu)
│   ├── PROFILE.md
│   ├── STATE.md
│   ├── DECISIONS.md
│   ├── domain-overview.md
│   ├── directory.md
│   └── handoffs/
│
├── src/                             # Mã nguồn ứng dụng & MCP Server mis_matrix (Node >= 22, zero deps)
│   ├── onboarding.mjs               # Pipeline setup tự động (Node >=22, /browse-open CDP, starter context, MCP config, smoke test)
│   ├── auth-manager.mjs             # Quản lý phiên API-first, tự reload .env.mis & silent recovery qua /browse-open CDP
│   ├── mcp-server.mjs               # Stdio JSON-RPC 2.0 MCP router (mis_matrix)
│   ├── tools.mjs                    # Đăng ký 49 MCP tools (31 read-only, 18 write)
│   ├── data-access.mjs              # Truy vấn check-in cá nhân (mis_query_my_tasks), phân tích ngày/tuần, lịch sử review & chuyển trạng thái
│   ├── collector.mjs                # Thu thập snapshot toàn tài khoản (mis_collect_account_data) & user timeline (mis_get_user_logs)
│   ├── client.mjs                   # HTTP client an toàn (chặn traversal, enforce MIS_READ_ONLY, tự retry khi 401 được phục hồi)
│   ├── config.mjs                   # Đọc/ghi .env.mis an toàn, kiểm tra HTTPS/loopback
│   └── cdp-auth.mjs                 # Trích xuất read-only cookie access_token từ Native Chrome CDP
│
├── scripts/                         # Công cụ CLI tạo docs & lưu trữ legacy có kiểm soát
│   ├── README.md
│   ├── analyze-openapi.mjs
│   ├── build-docs.mjs
│   └── legacy/                      # 4 script CDP one-off phụ thuộc workspace khác (gitignored)
│       └── MANIFEST.md
│
├── docs/                            # Tài liệu kiến trúc & đặc tả OpenAPI/UI
│   ├── SPECIFIC_AGENT_TEMPLATE.md
│   ├── WORKSPACE_STRUCTURE.md
│   ├── MIS-API-REFERENCE.md
│   └── MIS-UI-AND-MCP-BLUEPRINT.md
│
├── records/                         # [gitignored] Bằng chứng & quyết định xác minh (decisions.tsv)
├── reports/                         # [gitignored] Dữ liệu khảo sát OpenAPI, inline JS, DOM & screenshots minh chứng
├── exports/                         # [gitignored] Dữ liệu account & user timeline xuất từ mis_collect_account_data
├── .local/                          # [gitignored] Dữ liệu runtime tạm thời tại máy cục bộ
└── tests/                           # Bộ kiểm thử unit, workspace contract, onboarding, auth & live GET-only
    ├── mcp.test.mjs
    ├── workspace-contract.test.mjs
    ├── onboarding.test.mjs
    ├── auth-session.test.mjs
    └── live-readonly.test.mjs
```

---

## 3. Bảng Mapping Trước → Sau Chuẩn Hóa

| Thành phần trước đây | Trạng thái / Đích sau chuẩn hóa | Hành động đã thực hiện |
| :--- | :--- | :--- |
| `src/*.mjs` (9 module MCP server & runtime) | Giữ nguyên tại [`src/`](../src/mcp-server.mjs) | Bảo toàn cấu trúc nghiệp vụ; `49` tools (`31` read-only, `18` write), `AuthSessionManager`, `data-access.mjs` và `onboarding.mjs` hoạt động nguyên vẹn |
| `tests/*.test.mjs` (5 bộ test) | Giữ nguyên tại [`tests/`](../tests/workspace-contract.test.mjs) | Bổ sung kiểm tra `mcp_config.json`, `SPECIFIC_AGENT_TEMPLATE.md`, `src/data-access.mjs` và hàm kiểm toán transcript `auditPlaybookReadBeforeExecution` đồng bộ với `webex-agent` |
| `scripts/analyze-openapi.mjs`, `scripts/build-docs.mjs` | Giữ tại [`scripts/README.md`](../scripts/README.md) | Sử dụng đường dẫn tương đối (`fileURLToPath`), không hardcode đường dẫn máy cục bộ |
| `scripts/{crawl-readonly,extract-bearer-and-user,extract-scripts-and-auth,inspect-mis}.mjs` | Di chuyển sang `scripts/legacy/` (gitignored; chi tiết tại [`MANIFEST.md`](../scripts/legacy/MANIFEST.md)) | Lưu trữ có kiểm soát kèm `MANIFEST.md`; không xóa dữ liệu cục bộ |
| `docs/*` | [`docs/SPECIFIC_AGENT_TEMPLATE.md`](SPECIFIC_AGENT_TEMPLATE.md), [`docs/WORKSPACE_STRUCTURE.md`](WORKSPACE_STRUCTURE.md), [`docs/MIS-API-REFERENCE.md`](MIS-API-REFERENCE.md), [`docs/MIS-UI-AND-MCP-BLUEPRINT.md`](MIS-UI-AND-MCP-BLUEPRINT.md) | Đồng bộ khuôn mẫu Specific Agent với `webex-agent`; cập nhật chính xác số lượng `49` tools và `7` playbooks |
| `reports/`, `exports/`, `context/`, `records/`, `.env.mis` | Giữ nguyên 100% cục bộ (gitignored trên remote public) | Không xóa, không di chuyển; bảo vệ qua [`.gitignore`](../.gitignore) (bao gồm `.local/`) |
| Governance, Playbooks & Skills | [`AGENTS.md`](../AGENTS.md), `.agents/playbooks/*.md` (`7` playbooks), `.agents/skills/*/SKILL.md` (`3` skills) | Chuẩn hóa điều phối `poteto-mode` + `figure-it-out`, `Read-Playbook-First` và `Playbook / Skill Verification Gate` |

---

## 4. Chính sách giữ đường dẫn an toàn & Hướng dẫn Bàn giao (Handoff Guide)

1. **`src/mcp-server.mjs` giữ cố định tại `src/` (tương tự chính sách giữ `mcp/` của `webex-agent`):**
   - `package.json` (`"main": "src/mcp-server.mjs"`), `setup.mjs` và `~/.gemini/config/mcp_config.json` (`mcpServers.mis_matrix`) đều trỏ trực tiếp tới `src/mcp-server.mjs`. Giữ nguyên vị trí này đảm bảo tiến trình MCP host trên IDE không bị gãy kết nối giữa phiên.
2. **Bảo toàn tuyệt đối dữ liệu cục bộ (`exports/`, `reports/`, `context/`, `records/`, `.env.mis`):**
   - Toàn bộ snapshot tài khoản, file CSV/JSON xuất ra trong `exports/`, báo cáo khảo sát trong `reports/` và cấu hình `.env.mis` được giữ nguyên trên đĩa và loại trừ khỏi Git qua `.gitignore`.
3. **Hướng dẫn cho Agent phiên tiếp theo:**
   - Đọc [`../AGENTS.md`](../AGENTS.md) và chọn đúng playbook trong `.agents/playbooks/` trước khi gọi bất kỳ công cụ thực thi nào (`Read-Playbook-First`).
   - Với câu hỏi điểm danh / tiến độ task hằng ngày, chạy theo [`.agents/playbooks/checkin.md`](../.agents/playbooks/checkin.md) (`mis_query_my_tasks`).
   - Sau mọi chỉnh sửa mã nguồn hoặc cấu trúc workspace, thực thi đầy đủ [`.agents/playbooks/verify-and-evidence.md`](../.agents/playbooks/verify-and-evidence.md) (`node --check`, `npm test`, `records/decisions.tsv`).

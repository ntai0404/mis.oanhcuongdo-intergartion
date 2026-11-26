# Specific Agent Template & MIS-Matrix Mapping Blueprint

Tài liệu này chuẩn hóa khuôn mẫu **Specific Agent** dùng chung cho nhiều domain agent (**MIS-Matrix, Webex, X, GitHub, Browser, Coding, ERP**) dựa trên khảo sát trực tiếp `cursor/plugins/pstack` và cơ chế runtime thực tế của **Google Antigravity**, kèm bảng mapping triển khai cho workspace **MIS-Matrix Agent** (`https://mis.oanhcuongdo.com`).

---

## 1. Đối chiếu cơ chế trong `pstack` vs. Chuẩn Specific Agent Template (Antigravity)

| Trục thiết kế | Cơ chế trong `pstack` (Cursor) | Chuẩn áp dụng cho Specific Agent Template (Antigravity) |
| :--- | :--- | :--- |
| **Điểm vào & điều phối (`mode`)** | `skills/poteto-mode/SKILL.md` là skill điều phối trung tâm (`Non-negotiables`, `Principles`, `Autonomy`, `Subagents`, `Playbooks` router). | **`AGENTS.md`** ở root luôn nạp tự động (quy tắc bất biến + bảng routing `poteto-mode` + vòng lặp `figure-it-out` + map thư mục), kết hợp `.agents/playbooks/` và `.agents/skills/`. |
| **Vị trí `playbooks/`** | Nằm lồng bên trong `skills/poteto-mode/playbooks/`. | Đưa **`playbooks/` ra `.agents/playbooks/`** ngang hàng với `.agents/skills/` để mọi domain agent dùng chung cấu trúc chuẩn và kiểm chứng qua `Read-Playbook-First`. |
| **Năng lực tái sử dụng (`skills/`)** | `skills/` chứa các skill rời (`principle-*`, `show-me-your-work`, `create-verification-skill`, v.v.). | Đặt tại **`.agents/skills/<skill-name>/SKILL.md`** theo chuẩn Antigravity. Phân nhóm rõ: *domain skills* (`mis-account-collector`, `mis-project-ops`) và *cross-cutting skills* (`verify-evidence`). |
| **Định nghĩa Subagent (`agents/`)** | `agents/poteto-agent.md` và `agents/comment-sicko.md`. | Chỉ tạo `.agents/agents/<role>.md` khi có multi-agent workflow thực tế sử dụng; **tuyệt đối không tạo file placeholder rỗng**. |
| **Session pickup & Pause safely** | Cặp playbook đối xứng `session-pickup.md` và `pause-safely.md`. | Chuẩn hóa thành [`.agents/playbooks/session-pickup.md`](../.agents/playbooks/session-pickup.md) và [`.agents/playbooks/pause-safely.md`](../.agents/playbooks/pause-safely.md) gắn với `context/STATE.md` và `context/handoffs/` (chỉ cập nhật theo yêu cầu — *On-Demand Personal Context Policy*). |
| **Evidence & Verification (`prove-it-works`)** | `principle-prove-it-works` + `show-me-your-work` (`decisions.tsv` append-only). | Chuẩn hóa thành [`.agents/playbooks/verify-and-evidence.md`](../.agents/playbooks/verify-and-evidence.md), [`.agents/skills/verify-evidence/SKILL.md`](../.agents/skills/verify-evidence/SKILL.md) và `records/decisions.tsv`. |

---

## 2. Cấu trúc thư mục chuẩn Specific Agent

```text
<agent-workspace>/
├── AGENTS.md                        # Always-on contract: poteto-mode router, figure-it-out, safety & evidence rules
├── README.md                        # Hướng dẫn setup 1 lệnh (/browse-open), cấu hình MCP & kiểm thử
├── setup.mjs                        # Entrypoint onboarding tự động (Node.js >= 22, bắt buộc /browse-open CDP)
├── package.json                     # Metadata MCP server & scripts kiểm thử
├── .env.example                     # Mẫu biến môi trường không chứa secret
├── .gitignore                       # Bảo vệ .env*, context/, records/, reports/, exports/, downloads/, .local/
├── .agents/
│   ├── playbooks/                   # Quy trình tác nghiệp chuẩn (checkin, onboarding-auth, investigation, ...)
│   └── skills/                      # Năng lực tái sử dụng (<skill-name>/SKILL.md)
├── context/                         # [gitignored] Ngữ cảnh cá nhân & trạng thái phiên (PROFILE, STATE, DECISIONS, handoffs/)
├── src/                             # Mã nguồn MCP server & core runtime (hoặc mcp/ + tools/)
├── scripts/                         # Công cụ CLI tạo tài liệu & scripts/legacy/ (kèm MANIFEST.md)
├── docs/                            # Tài liệu kiến trúc (WORKSPACE_STRUCTURE.md, SPECIFIC_AGENT_TEMPLATE.md, specs)
├── records/                         # [gitignored] Decision trail (decisions.tsv) & bằng chứng kiểm thử
├── exports/                         # [gitignored] Snapshot dữ liệu xuất cục bộ
├── tests/                           # Kiểm thử tự động (unit, workspace contract, onboarding, auth, live-readonly)
└── .local/                          # [gitignored] Dữ liệu runtime cục bộ không commit
```

### 2.1. Khả năng tổng quát hóa cho các loại Specific Agent

| Domain Agent | `context/` chứa gì? | Runtime & MCP Server | `.agents/skills/` đặc trưng | `records/` & Verification | Dữ liệu local gitignored |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MIS-Matrix Agent** | `PROFILE.md`, `STATE.md`, `DECISIONS.md`, `domain-overview.md`, `directory.md`, `handoffs/` | [`src/mcp-server.mjs`](../src/mcp-server.mjs) (`49` tools: `31` read-only, `18` write), [`src/auth-manager.mjs`](../src/auth-manager.mjs) | `mis-account-collector`, `mis-project-ops`, `verify-evidence` | `records/decisions.tsv`, `npm test`, `npm run test:live-readonly` | `.env.mis`, `exports/`, `reports/`, `downloads/`, `.local/` |
| **Webex Agent** | Rooms/DMs, người liên hệ, UAT vs LIVE URLs, `handoffs/` | `mcp/webex_web_mcp.py` (`9` tools), `tools/webex_*.py`, `tools/cli/` | `webex-checkin`, `webex-support-draft`, `verify-evidence` | `records/decisions.tsv`, `transcripts/`, `pytest` | `.local/`, `downloads/`, `records/` |
| **GitHub Agent** | Repo map, branch policy, CI workflows, reviewers, `handoffs/` | `gh` CLI wrapper, GitHub MCP | `pr-babysit`, `pr-ship`, `blast-radius` | PR diffs, CI run logs, `decisions.tsv` | Worktrees tạm, build cache |
| **Browser Agent** | Target app URLs, test accounts (non-secret), selectors, `handoffs/` | `browse_open` Native Chrome CDP MCP | `verify-<app>`, `visual-parity` | Screenshots before/after, DOM/network trace | Browser profiles, downloads |
| **Coding Agent** | Architecture invariants, module boundaries, `handoffs/` | LSP/build/test runners, linter CLI | `tdd`, `architect`, `interrogate`, `unslop` | Test/build output, benchmark logs | Build artifacts, cache |
| **ERP Agent** | Phân hệ, mã chứng từ, môi trường UAT/Prod | ERP API/DB read-only MCP | `erp-reconcile`, `erp-uat-verify` | Bảng đối chiếu số liệu, chứng từ UAT | Export CSV tạm, session cookies |

---

## 3. Mapping Kiến Trúc `MIS-matrix` theo Khuôn Mẫu Chuẩn

Xem chi tiết cây thư mục, luồng điều phối và chính sách giữ đường dẫn an toàn tại [`docs/WORKSPACE_STRUCTURE.md`](WORKSPACE_STRUCTURE.md):

1. **Giữ liên kết MCP toàn cục không gãy:** Entrypoint MCP server giữ cố định tại [`src/mcp-server.mjs`](../src/mcp-server.mjs) (được đăng ký trong `~/.gemini/config/mcp_config.json` dưới khóa `mcpServers.mis_matrix` bởi [`setup.mjs`](../setup.mjs) và được kiểm tra tự động trong [`tests/workspace-contract.test.mjs`](../tests/workspace-contract.test.mjs)).
2. **Bảo toàn 100% dữ liệu & chức năng:** Toàn bộ `49` MCP tools (`31` read-only, `18` write), cơ chế `AuthSessionManager` tự phục hồi phiên qua `.env.mis` / `/browse-open` CDP, và toàn bộ dữ liệu cục bộ (`exports/`, `reports/`, `context/`, `records/`, `.env.mis`) được giữ nguyên vẹn.
3. **Kiểm chứng bắt buộc bằng Contract Tests:** [`tests/workspace-contract.test.mjs`](../tests/workspace-contract.test.mjs) kiểm tra tự động cấu trúc file, ngân sách dung lượng `AGENTS.md` (`<= 12,000` bytes), toàn bộ relative links trong Markdown, bất biến `49` tools (`31` read-only / `18` write), cấu hình `mcp_config.json`, và hàm kiểm toán transcript `auditPlaybookReadBeforeExecution` (`Read-Playbook-First`).

# Specific Agent Workspace Structure (`MIS-matrix`)

Tài liệu mô tả cấu trúc Specific Agent độc lập của workspace `MIS-matrix`, bảng mapping trước/sau tái cấu trúc và các bất biến an toàn.

## 1. Cây thư mục chuẩn

```text
MIS-matrix/
├── AGENTS.md                        # Always-on contract: dispatch poteto-mode, playbooks/skills, guardrails
├── README.md                        # Hướng dẫn cài đặt, đăng ký MCP và chạy kiểm thử
├── package.json                     # Entrypoint mis_matrix MCP & scripts (test, test:mcp, test:contract, test:live-readonly)
├── .env.example                     # Mẫu cấu hình môi trường (không chứa secret thật)
├── .env.mis                         # [gitignored, local-only] MIS_BASE_URL & MIS_BEARER_TOKEN thực tế
├── .gitignore                       # Bỏ qua .env, .env.* (!.env.example), secrets/, context/, records/, reports/, exports/, downloads/, scripts/legacy/*.mjs
│
├── .agents/                         # Lớp điều phối & năng lực Specific Agent
│   ├── playbooks/                   # 6 quy trình tác nghiệp chuẩn
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
│       └── 2026-11-19_specific-agent-refactor.md
│
├── src/                             # Mã nguồn ứng dụng & MCP Server mis_matrix (Node >= 22, zero deps)
│   ├── mcp-server.mjs
│   ├── tools.mjs
│   ├── collector.mjs
│   ├── client.mjs
│   ├── config.mjs
│   └── cdp-auth.mjs
│
├── scripts/                         # Công cụ CLI tạo docs & lưu trữ legacy có kiểm soát
│   ├── README.md
│   ├── analyze-openapi.mjs
│   ├── build-docs.mjs
│   └── legacy/                      # 4 script CDP one-off phụ thuộc workspace khác
│       ├── MANIFEST.md
│       ├── crawl-readonly.mjs
│       ├── extract-bearer-and-user.mjs
│       ├── extract-scripts-and-auth.mjs
│       └── inspect-mis.mjs
│
├── docs/                            # Tài liệu kiến trúc & đặc tả OpenAPI/UI
│   ├── WORKSPACE_STRUCTURE.md
│   ├── MIS-API-REFERENCE.md
│   └── MIS-UI-AND-MCP-BLUEPRINT.md
│
├── records/                         # Bằng chứng & quyết định xác minh
│   └── decisions.tsv
│
├── reports/                         # Dữ liệu khảo sát OpenAPI, inline JS, DOM & screenshots minh chứng
├── exports/                         # [gitignored] Dữ liệu account & user timeline xuất từ mis_collect_account_data
└── tests/                           # Bộ kiểm thử unit, workspace contract & live GET-only
    ├── mcp.test.mjs
    ├── workspace-contract.test.mjs
    └── live-readonly.test.mjs
```

## 2. Bảng Mapping Trước → Sau Tái Cấu Trúc

| Thành phần trước đây | Trạng thái / Đích sau tái cấu trúc | Hành động đã thực hiện |
| --- | --- | --- |
| `src/*.mjs` (6 file MCP server) | Giữ nguyên tại [src/](../src/mcp-server.mjs) | Giữ nguyên cấu trúc nghiệp vụ; 48 tools (`30` read-only, `18` write) hoạt động nguyên vẹn |
| `tests/mcp.test.mjs`, `tests/live-readonly.test.mjs` | Giữ nguyên + bổ sung [tests/workspace-contract.test.mjs](../tests/workspace-contract.test.mjs) | Bổ sung contract tests kiểm tra `AGENTS.md`, playbooks, skills, links, legacy & schema |
| `scripts/analyze-openapi.mjs`, `scripts/build-docs.mjs` | Giữ tại [scripts/README.md](../scripts/README.md) | Loại bỏ đường dẫn máy cục bộ hardcode, chuyển sang `fileURLToPath` |
| `scripts/{crawl-readonly,extract-bearer-and-user,extract-scripts-and-auth,inspect-mis}.mjs` | Di chuyển sang `scripts/legacy/` (gitignored; chi tiết tại [MANIFEST.md](../scripts/legacy/MANIFEST.md)) | Di chuyển có kiểm soát kèm `MANIFEST.md`; không chỉnh nội dung file cũ, không xóa |
| `docs/MIS-API-REFERENCE.md`, `docs/MIS-UI-AND-MCP-BLUEPRINT.md` | Giữ tại `docs/` + thêm [WORKSPACE_STRUCTURE.md](WORKSPACE_STRUCTURE.md) | Giữ nguyên spec; redact PII cá nhân & cập nhật dòng tham chiếu script token sang `mis_refresh_token_from_cdp` / `scripts/legacy/` |
| `reports/`, `exports/`, `.env.mis` | Giữ nguyên 100% cục bộ (gitignored trên remote public) | Không xóa, không di chuyển; bổ sung `context/`, `records/`, `reports/`, `exports/`, `downloads/`, `scripts/legacy/*.mjs` vào [.gitignore](../.gitignore) |
| *(Mới)* Governance & Routing | [AGENTS.md](../AGENTS.md), [.env.example](../.env.example), `package.json` | Bổ sung handbook `poteto-mode` + `figure-it-out`, template env, script `test:mcp` & `test:contract` |
| *(Mới)* Playbooks & Skills | `.agents/playbooks/*.md` (6), `.agents/skills/*/SKILL.md` (3) | Chuẩn hóa quy trình pickup, pause, investigation, collect, onboarding, verify; bỏ qua `.agents/agents/` thừa |
| *(Mới)* Context & Records | `context/*`, `context/handoffs/*`, [records/decisions.tsv](../records/decisions.tsv) | Tạo Personal Context on-demand & bảng vết kiểm chứng append-only |

## 3. Nguyên tắc vận hành

1. **Dispatch:** Khớp playbook trong `.agents/playbooks/` thì đọc playbook trước khi thao tác; chưa có playbook thì chạy vòng `figure-it-out` (khảo sát -> thực thi an toàn -> kiểm chứng). Không giới hạn nhiệm vụ vào số skill hiện có.
2. **Personal Context:** Chỉ cập nhật `context/` khi người dùng yêu cầu hoặc khi Pause Safely / bàn giao; không đồng bộ ngầm theo lịch.
3. **Verification-First & Safety:** Live test chỉ chạy `GET` (`MIS_READ_ONLY` enforced); không ghi lên web thật hoặc commit/push Git khi chưa có lệnh rõ ràng.

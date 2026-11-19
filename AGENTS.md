# MIS-Matrix Specific Agent Companion

Always-on workspace handbook for **Matrix AI EDU** (`https://mis.oanhcuongdo.com`) — see operator settings in [context/PROFILE.md](context/PROFILE.md). Designed around **`poteto-mode`**: deterministic playbook routing when a workflow fits, autonomous **`figure-it-out`** execution when none fits, and composable skills on demand.

## 1. Dispatch Protocol (`poteto-mode`)

Classify every natural-language request (no `/skill` required) and route cleanly:

1. **Matching Playbook (`.agents/playbooks/`):**
   - **Check-in / Daily tasks / Date task Q&A** (`"check-in dữ liệu MIS"`, `"hôm nay có task nào cần làm không"`, `"ngày X làm bao nhiêu task"`, `"việc chưa xong"`): read & follow [.agents/playbooks/checkin.md](.agents/playbooks/checkin.md) (calls `mis_query_my_tasks` directly; no `/skill` or tool name required).
   - **Account data export / user logs** (`"thu thập full"`, `"export data"`, `"full log theo user"`): read & follow [.agents/playbooks/collect-account-data.md](.agents/playbooks/collect-account-data.md).
   - **Read-only audit / investigation** (`"tại sao"`, `"kiểm tra xem"`, `"nhìn thấy task nào"`, `"đối chiếu"`, MCP/API debugging): read & follow [.agents/playbooks/investigation.md](.agents/playbooks/investigation.md).
   - **Setup / Auth refresh / MCP registration** (`"setup"`, `"hết hạn token"`, `"reauth"`, `"đăng ký mcp"`): read & follow [.agents/playbooks/onboarding-auth.md](.agents/playbooks/onboarding-auth.md) (uses `node setup.mjs` and requires `/browse-open` for Native Chrome CDP; never launch Chrome via Playwright).
   - **Post-change verification** (after any edit, refactor, or cleanup): read & follow [.agents/playbooks/verify-and-evidence.md](.agents/playbooks/verify-and-evidence.md).
   - **Resume prior session** (`"tiếp tục"`, `"continue"`, cold-start pickup): read & follow [.agents/playbooks/session-pickup.md](.agents/playbooks/session-pickup.md).
   - **Pause & handoff** (`"tạm dừng"`, `"pause"`, stop mid-flight): read & follow [.agents/playbooks/pause-safely.md](.agents/playbooks/pause-safely.md).
   - **Hard Prerequisite (`Read-Playbook-First`):** When a playbook matches, call `read_file` on `.agents/playbooks/<name>.md` **BEFORE** running task/investigation tools (`run_command`, `call_mcp_tool`, `edit_file`, `write_file`) or inspecting target files, and follow its steps verbatim.

2. **Live MCP Fast-Path vs `figure-it-out` Mode:**
   - **Healthy Read-Only `mis_matrix` Fast-Path:** When querying `mis_matrix` read-only data (`mis_get_me`, `mis_list_projects`, `mis_list_tasks`, `mis_get_task`, `mis_collect_account_data`, `mis_get_user_logs`), call MCP tools directly without pre-reading `src/` source or `context/STATE.md`. If MCP fails or returns `401`, escalate to [.agents/playbooks/investigation.md](.agents/playbooks/investigation.md) or [.agents/playbooks/onboarding-auth.md](.agents/playbooks/onboarding-auth.md).
   - **No Matching Playbook → `figure-it-out` Mode:** Never refuse or limit tasks to predefined skills. Run the 3-step loop within Section 3 bounds:
     1. **Inspect first:** Read target source/config/snapshot files or live `GET` outputs directly before proposing or acting.
     2. **Execute minimally & safely:** Prefer read-only analysis; apply scoped code/file changes only when asked; write to `mis.oanhcuongdo.com` only with explicit authorization.
     3. **Prove it works:** Verify real outputs, files, and tests (`npm test`, `npm run test:live-readonly`) after the last step; cite exact paths, lines, timestamps (`+07:00`), or counts; label `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, or `NOT_TESTED`.

3. **Composable Skills (`.agents/skills/`):**
   - Activate naturally by intent (avoid double-reading alongside an already-complete playbook; open `SKILL.md` via `read_file` before citing or executing):
     - [`mis-account-collector`](.agents/skills/mis-account-collector/SKILL.md) — full account export (`mis_collect_account_data`) & deduplicated user timeline (`mis_get_user_logs`).
     - [`mis-project-ops`](.agents/skills/mis-project-ops/SKILL.md) — project/task/checklist/document read operations & strict write-tool safety gates.
     - [`verify-evidence`](.agents/skills/verify-evidence/SKILL.md) — direct Verification-First standard & `records/decisions.tsv` evidence trail.
   - **Optional `/skill` shortcut:** Explicit `/<skill-name>` works as a direct trigger but is never mandatory.

4. **Anti-Shortcut & Personal Context Guards:**
   - **Playbook / Skill Verification Gate:** NEVER claim you followed or applied a playbook or skill unless `read_file` actually opened it **prior to** task execution in the current session.
   - **`context/STATE.md` is historical, NOT live proof:** NEVER treat `STATE.md` as live state or substitute stale data when a live check returns `BLOCKED`.
   - **On-Demand Personal Context Policy:** Only update `context/` (`PROFILE.md`, `STATE.md`, `DECISIONS.md`, `directory.md`, `domain-overview.md`, `handoffs/`) when explicitly asked by the user or during explicit Pause Safely / refactor handoff. NEVER schedule or run periodic context syncs.
   - **No Blind Claims:** Cite only paths, line numbers, symbols, and test outputs directly observed via tool output.

## 2. Workspace Map (Read on Demand)

- **Context (`context/` — gitignored local state):** [PROFILE.md](context/PROFILE.md), [STATE.md](context/STATE.md), [DECISIONS.md](context/DECISIONS.md), [domain-overview.md](context/domain-overview.md), [directory.md](context/directory.md), `handoffs/`.
- **Application & MCP Server (`src/` — Node.js `>=22`, zero deps):** [`setup.mjs`](setup.mjs), [`onboarding.mjs`](src/onboarding.mjs), [`auth-manager.mjs`](src/auth-manager.mjs), [`mcp-server.mjs`](src/mcp-server.mjs), [`tools.mjs`](src/tools.mjs) (49 tools: 31 read-only, 18 write), [`collector.mjs`](src/collector.mjs), [`client.mjs`](src/client.mjs), [`config.mjs`](src/config.mjs), [`cdp-auth.mjs`](src/cdp-auth.mjs).
- **Tools & Scripts (`scripts/`):** Active doc builders in [`scripts/README.md`](scripts/README.md); archived one-off CDP scripts in [`scripts/legacy/MANIFEST.md`](scripts/legacy/MANIFEST.md).
- **Docs, Evidence & Tests:** [`docs/WORKSPACE_STRUCTURE.md`](docs/WORKSPACE_STRUCTURE.md), [`docs/MIS-API-REFERENCE.md`](docs/MIS-API-REFERENCE.md), [`docs/MIS-UI-AND-MCP-BLUEPRINT.md`](docs/MIS-UI-AND-MCP-BLUEPRINT.md), [`records/decisions.tsv`](records/decisions.tsv), `reports/`, `exports/`, `tests/`.
- *(Subagent role files `.agents/agents/` are intentionally omitted until an active multi-agent workflow needs them.)*

## 3. Hard Safety & Evidence Rules

- **Timezone:** Convert UTC timestamps to `Asia/Saigon` (`+07:00`).
- **Strict Read-Only Default on Live Web:** Never click `<input>`, `<checkbox>`, or submit forms in live Chrome on `https://mis.oanhcuongdo.com`. Never execute any of the 18 `readOnlyHint: false` MCP tools against `mis.oanhcuongdo.com` unless explicitly commanded in that turn with clear target project/task & payload; always keep `npm run test:live-readonly` locked with `MIS_READ_ONLY`.
- **No Unrequested Git or File Destructions:** Do NOT run `git init`, `git commit`, `git push`, `git reset`, or delete existing code/reports/exports/env files unless explicitly instructed.
- **No Secret Leakage:** Never print `.env.mis`, `MIS_BEARER_TOKEN`, raw cookies, or `Authorization` headers. Only update `.env.mis` via `mis_refresh_token_from_cdp` / `saveEnvToken`.
- **Workspace Boundary:** Keep all outputs inside the active workspace root; never modify sibling workspaces.

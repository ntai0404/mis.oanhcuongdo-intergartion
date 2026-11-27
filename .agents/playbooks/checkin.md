# MIS Check-in & Natural Task Q&A Playbook

Use when the user asks in natural language to check in on their MIS tasks, see what needs doing today, inspect what tasks they worked on or completed on a specific date, or review weekly progress (`"check-in dữ liệu MIS"`, `"hôm nay có task nào cần làm không"`, `"ngày X tao làm bao nhiêu task"`, `"hôm qua tôi đã làm"`, `"tiến độ từ đầu tuần tới hôm nay"`, `"còn việc gì chưa xong"`).

1. **Go straight to live MIS (MCP-first, Direct-CLI fallback, zero pre-read bloat):**
   - After reading this playbook, do **NOT** read `context/STATE.md`, `context/directory.md`, `context/PROFILE.md`, `.agents/skills/*`, or `src/*.mjs` source files.
   - **If `mis_matrix` MCP is mounted in your harness (e.g. Antigravity):** Call `mis_query_my_tasks` directly via MCP (strictly read-only `GET`) and **keep `include_done` omitted/`false`** (`summary.doneCount`, `dateAnalysis`, and `periodAnalysis` already cover `DONE` tasks).
   - **If `mis_matrix` MCP is NOT mounted in your harness (e.g. Codex, Claude Code, Cursor, OpenCode, or any zero-config CLI/IDE):** Do **NOT** look for `<appDataDir>\mcp\mis_matrix\*.json` and do **NOT** report `BLOCKED`. Run the exact same tool directly via the workspace CLI runner:
     ```powershell
     node src/mcp-server.mjs mis_query_my_tasks --date_vn today
     ```
     *(If the first shell call in a new session hits a transient sandbox startup glitch such as `helper_unknown_error: setup refresh had errors`, retry the command once before concluding anything failed.)*
   - **Query arguments by intent (via MCP or `node src/mcp-server.mjs mis_query_my_tasks ...`):**
     - For daily check-in / *"hôm nay có task nào cần làm không?"*: `mis_query_my_tasks({ date_vn: "today" })` (or `--date_vn YYYY-MM-DD` in `+07:00`).
     - For a specific date *"Ngày X / hôm qua làm và hoàn thành những task nào?"*: `mis_query_my_tasks({ date_vn: "YYYY-MM-DD" })` (or `--date_vn yesterday`).
     - For weekly / date-range progress *"Tiến độ từ đầu tuần tới hôm nay thế nào?"*: `mis_query_my_tasks({ date_from: "<monday YYYY-MM-DD>", date_to: "<today YYYY-MM-DD>" })` (keeping `include_done` omitted/`false`).
   - Answer directly from the returned payload without writing scratch scripts or pre-reading `src/` / `context/STATE.md`. Only if the execution itself returns `SESSION_EXPIRED` or `401`, escalate to [onboarding-auth.md](onboarding-auth.md).
2. **Strict Status & Evidence Separation (Never Infer Without Evidence):**
   - Always separate:
     - **Task được giao chưa làm (`TODO`)**
     - **Task đang làm (`IN_PROGRESS`)**
     - **Task đang chờ review (`INTERNAL_REVIEW` / `MENTOR_REVIEW`)**
     - **Task đã hoàn thành (`DONE`)**
     - **Việc mở có thể nhận (`claimable_open`)**
   - For date-specific or period questions (`date_vn` or `date_from`/`date_to`), separate strictly:
     - **`worked_on_date`**: tasks with direct user-attributed timestamps in the window (`comments[].created_at`, system logs with user's `user_id`, or `reports[].created_at`).
     - **`completed_on_date`**: tasks in the current assignment cohort with a direct `DONE` status transition log in the window (distinguishing the logged transition actor from the current assignee; do not claim formal approval unless separately recorded).
     - **`review_on_date`**: tasks with explicit `INTERNAL_REVIEW` / `MENTOR_REVIEW` / `DONE` status transition logs in the window.
     - **`claimed_on_date`**: claim timestamps on currently assigned tasks (the API supplies no claim actor ID).
     - **`deadline_on_date`**: tasks due in the window (`deadline_only` — NEVER count as "worked on that day" without activity evidence).
   - State `schemaCaveat` and `coverage` limits transparently (current assignment cohort scope, no task `created_at`/`completed_at` fields, and no formal approval ledger).
3. **Required Reply Elements:**
   - Include task list (with project name & deadline in `+07:00`), exact counts per bucket/period category, status, and verified data source (`sourceMode`, `dataSources`, `checkedAtVn`).
   - Never mutate live MIS data or edit workspace files during a check-in.

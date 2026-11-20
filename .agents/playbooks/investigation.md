# Investigation Playbook

Use for read-only questions, audits, API/UI analysis, project/task/checklist inspection, or troubleshooting (`"tại sao"`, `"kiểm tra xem"`, `"đối chiếu"`, `"nhìn thấy task nào"`, `"hoạt động gì gần đây"`, `"chi tiết task"`, `"ai đưa task ... vào review"`, lỗi MCP/test).

1. State the exact question and scope before reading target files or calling live tools. Do **not** pre-read `src/` or `context/` when answering standard MIS project/task queries via healthy MCP tools.
2. Choose the compact read-only (`GET`) MCP path matching the question (never write scratch scripts when compact MCP data suffices):
   - **Recent project activity** (*"Dự án X có hoạt động gì gần đây?"*): `mis_list_projects` -> `mis_get_user_logs({ project_id, all_actors: true, compact: true, limit: 25 })` (prefer over raw `mis_get_project_feed`, and do **not** call uncompacted `mis_list_tasks`). Explain `coverage` limits (e.g., feed-only rows may carry display name without actor ID; `next_offset` indicates more rows).
   - **Find task by title or subtask:** `mis_list_projects` -> `mis_list_tasks({ project_id, compact: true, search: "..." })`.
   - **Task details (checklist, comment, report):** Call `mis_get_task({ project_name, task_title, view: "summary" })` directly. Use IDs when known. Read exact totals from `comment_counts`; grouped history entries are examples. Use `view: "full"` when the user asks for verbatim comment or report content.
   - **Task review, status transition, or assignment history** (*"Ai đưa task vào review và khi nào?"*, *"ai giao task?"*): Call `mis_get_task({ project_name, task_title, view: "review" })` for review or `view: "history"` for other changes. Use IDs when known. Read `actor_user_id`, `actor_name`, `timestamp_vn` and `coverage` from the response. Follow `next_offset` when more events are needed.
   - **Code/API debugging:** inspect targeted lines of `src/`, `scripts/`, `docs/`, or `reports/` only when investigating code/API defects.
3. Keep live web inspection strictly read-only:
   - Never invoke `readOnlyHint: false` MCP tools during an investigation.
   - Never click `<input>`, `<checkbox>`, or form submission controls in Chrome on `https://mis.oanhcuongdo.com`.
   - Never mutate workspace code, `.env.mis`, or Git state unless the user explicitly asked for changes.
4. Cite exact file paths, line ranges, timestamps (`+07:00`), HTTP statuses, or tool outputs for every factual claim; label inferences clearly as inferred.
5. If a live check fails (`401`/`403`, CDP closed, network error), report `BLOCKED` or `NOT_TESTED` with the exact error instead of substituting stale `context/STATE.md` data.

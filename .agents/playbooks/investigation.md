# Investigation Playbook

Use for read-only questions, audits, API/UI analysis, project/task/checklist inspection, or troubleshooting (`"tại sao"`, `"kiểm tra xem"`, `"đối chiếu"`, `"nhìn thấy task nào"`, lỗi MCP/test).

1. State the exact question and scope before reading target files or calling live tools.
2. Inspect real source files (`src/`, `scripts/`, `docs/`), saved snapshots (`reports/`, `exports/`), or strictly `GET`-only MCP tools (`mis_get_project`, `mis_list_tasks`, `mis_get_task`, `mis_get_project_feed`, `mis_get_user_logs`).
3. Keep live web inspection strictly read-only:
   - Never invoke `readOnlyHint: false` MCP tools during an investigation.
   - Never click `<input>`, `<checkbox>`, or form submission controls in Chrome on `https://mis.oanhcuongdo.com`.
   - Never mutate workspace code, `.env.mis`, or Git state unless the user explicitly asked for changes.
4. Cite exact file paths, line ranges, timestamps (`+07:00`), HTTP statuses, or tool outputs for every factual claim; label inferences clearly as inferred.
5. If a live check fails (`401`/`403`, CDP closed, network error), report `BLOCKED` or `NOT_TESTED` with the exact error instead of substituting stale `context/STATE.md` data.

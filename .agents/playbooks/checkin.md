# MIS Check-in & Natural Task Q&A Playbook

Use when the user asks in natural language to check in on their MIS tasks, see what needs doing today, or inspect what tasks they worked on or completed on a specific date (`"check-in dữ liệu MIS"`, `"hôm nay có task nào cần làm không"`, `"ngày X tao làm bao nhiêu task"`, `"còn việc gì chưa xong"`).

1. **Direct Read-Only MCP Query (Zero Source Pre-Reads):**
   - Call `mis_query_my_tasks` directly (strictly read-only `GET`):
     - For daily check-in / *"hôm nay có task nào cần làm không?"*: call `mis_query_my_tasks({ date_vn: "<today YYYY-MM-DD in +07:00>" })`.
     - For a specific date *"Ngày X tao làm bao nhiêu task, gồm những task nào?"*: call `mis_query_my_tasks({ date_vn: "YYYY-MM-DD" })`.
   - Do **not** pre-read `src/` source or `context/STATE.md` while MCP is healthy. If MCP returns `SESSION_EXPIRED` or `401`, escalate to [onboarding-auth.md](onboarding-auth.md).
2. **Strict Status & Evidence Separation (Never Infer Without Evidence):**
   - Always separate:
     - **Task được giao chưa làm (`TODO`)**
     - **Task đang làm (`IN_PROGRESS`)**
     - **Task đang chờ review (`INTERNAL_REVIEW` / `MENTOR_REVIEW`)**
     - **Task đã hoàn thành (`DONE`)**
     - **Việc mở có thể nhận (`claimable_open`)**
   - For date-specific questions (`date_vn`), separate strictly:
     - **`worked_on_date`**: tasks with direct user-attributed timestamps on `date_vn` (`comments[].created_at`, `reports[].created_at`, or `claimed_at`).
     - **`completed_on_date`**: tasks with a direct `DONE` status transition log on `date_vn` (distinguishing approver vs assignee).
     - **`deadline_on_date`**: tasks due on `date_vn` (`deadline_only` — NEVER count as "worked on that day" without activity evidence).
   - State `schemaCaveat` transparently whenever the user asks about creation/completion dates not backed by explicit logs.
3. **Required Reply Elements:**
   - Include task list (with project name & deadline in `+07:00`), exact counts per bucket, status, and verified data source (`sourceMode`, `dataSources`, `checkedAtVn`).
   - Never mutate live MIS data or edit workspace files during a check-in.

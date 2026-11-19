---
name: mis-project-ops
description: >-
  Inspect Matrix AI EDU projects, tasks, checklists, documents, courses, and
  analytics safely via read-only tools, and enforce strict user-confirmation
  gates before any write or mutation operation on live mis.oanhcuongdo.com.
---

# MIS Project Operations Skill

Covers day-to-day project/task/document workflows implemented in [src/tools.mjs](../../../src/tools.mjs) (`30` read-only tools, `18` write tools).

## 1. Read-Only First

- Prefer the `30` `readOnlyHint: true` tools (`mis_list_projects`, `mis_get_project`, `mis_get_project_members`, `mis_get_project_feed`, `mis_get_project_performance`, `mis_list_tasks`, `mis_get_task`, `mis_list_documents`, `mis_list_courses`, `mis_view_task_report_log`, etc.).
- When cross-checking Chrome UI vs API, verify `https://mis.oanhcuongdo.com` via read-only CDP / DOM inspection without clicking inputs, checkboxes, or submit buttons.

## 2. Strict Write Gate (`readOnlyHint: false`)

- NEVER run any of the `18` write tools (`mis_create_task`, `mis_update_task`, `mis_delete_task`, `mis_claim_task`, `mis_release_task`, checklist mutations, `mis_submit_task_report`, comments, document creation, AI explain/suggest POSTs, or `mis_raw_api` non-GET) during audits, refactors, or automated tests against live `mis.oanhcuongdo.com`.
- Execute a live write tool **only** when the user gives an explicit command naming the target project/task and intended change in that turn; verify the result afterward via `mis_get_task` or `mis_list_tasks` (`GET`).
- Note `MIS_READ_ONLY=1` blocks all non-GET HTTP calls at the client boundary (`READ_ONLY_MODE` in [src/client.mjs](../../../src/client.mjs)).

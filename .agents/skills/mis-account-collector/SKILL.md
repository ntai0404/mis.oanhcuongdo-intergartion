---
name: mis-account-collector
description: >-
  Collect full account-scoped data from Matrix AI EDU via read-only GET APIs,
  build deduplicated user activity timelines across projects, and query offline
  JSON snapshots safely without bloating agent context.
---

# MIS Account Collector Skill

Use when retrieving comprehensive account snapshots or auditing a user's cross-project activity (`comments`, `system_logs`, `reports`, `checklists`, `feed`).

## 1. Account Collection (`mis_collect_account_data`)

- Backed by [collectAccountData](../../../src/collector.mjs); enforces strictly `GET`-only requests.
- Keep `include_inline_summary_only: true` by default so large payloads are persisted cleanly under `exports/acc-<user>-<timestamp>/` (`manifest.json`, `account.json`, `projects/*.json`, `courses/*.json`, `user-timeline.json`, `full-snapshot.json`) plus `exports/latest-manifest.json`.
- Enable opt-in flags (`include_gallery`, `include_ai_summary`, `download_report_files`, `download_document_files`) only when the task explicitly requires gallery pages (1,300+ items), AI summaries, or binary downloads.

## 2. User Timeline Extraction (`mis_get_user_logs`)

- Backed by [queryUserLogs](../../../src/collector.mjs) and `buildUserTimeline`.
- Pass `snapshot_path` pointing to an existing `manifest.json` or `full-snapshot.json` inside the workspace to filter offline without extra network calls.
- Filter precisely via `user_id` or `email`, `project_id`, `types` (`comment`, `system_log`, `report`, `checklist`, `feed`), `include_system_logs`, `date_from`, `date_to`, and `limit`.
- Distinguish manual discussions (`is_system_log: false`) from automated audit/status events (`is_system_log: true`) in summaries.

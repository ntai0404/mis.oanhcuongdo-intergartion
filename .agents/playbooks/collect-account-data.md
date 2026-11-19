# Collect Account Data Playbook

Use when asked to collect, refresh, or extract full account-scoped data from `https://mis.oanhcuongdo.com` or query full activity/chat logs for a user.

1. Read [.agents/skills/mis-account-collector/SKILL.md](../skills/mis-account-collector/SKILL.md) first if collecting full snapshots or querying multi-project user timelines.
2. Verify read-only authentication (`GET /api/v1/auth/me` via `mis_get_me` or `MIS_BEARER_TOKEN` in `.env.mis`); if `401`/`AUTH_REQUIRED`, escalate to [onboarding-auth.md](onboarding-auth.md) and stop — never inspect or print `.env.mis` secrets.
3. Enforce read-only calls (`GET`-only):
   - Full account export: invoke `mis_collect_account_data` with `include_inline_summary_only: true` so large JSON stays on disk under `exports/` instead of flooding chat context.
   - User timeline / logs: invoke `mis_get_user_logs` (prefer `snapshot_path` pointing to an existing `manifest.json` or `full-snapshot.json` when querying repeatedly/offline; omit `snapshot_path` when fresh live data is required).
4. Verify the generated `manifest.json`, `full-snapshot.json`, and `user-timeline.json` exist on disk with non-zero counts before reporting stats.
5. Never trigger background/scheduled refreshes of `context/` automatically; only touch `context/` if the user explicitly requested a context update.

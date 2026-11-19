# Pause Safely Playbook

Use when suspending in-flight work cleanly so another Codex/Antigravity session can resume cold-start without losing progress.

1. Stop at an atomic, non-broken boundary; do not leave half-edited files or partial refactors.
2. Perform no irreversible actions: zero unrequested write calls against `https://mis.oanhcuongdo.com`, zero unrequested Git init/commits/pushes, zero deletion of unverified files or data.
3. Update [context/STATE.md](../../context/STATE.md) with exact `DONE`, `PENDING`, `NOT_TESTED`, and `BLOCKED` status (with timestamps in `+07:00`).
4. Write a concise handoff note in `context/handoffs/<YYYY-MM-DD>_<slug>.md` recording: goal, completed artifacts/paths, pending steps, gotchas/constraints, and exact first resume check.
5. Reply with where work stopped, what is persisted on disk, and the exact command or file to open first on resume.

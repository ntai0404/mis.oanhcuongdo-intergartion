# Session Pickup Playbook

Use when resuming or taking over work from an earlier session or agent (`"tiếp tục"`, `"continue"`, cold-start pickup).

1. Read [AGENTS.md](../../AGENTS.md), [context/STATE.md](../../context/STATE.md), and [context/DECISIONS.md](../../context/DECISIONS.md).
2. Read the latest handoff note in `context/handoffs/` and the tail of [records/decisions.tsv](../../records/decisions.tsv).
3. If finer execution detail is needed, inspect only the active workspace artifacts or the current conversation transcript (never invent facts from stale memory).
4. Reconcile `DONE`, `PENDING`, `NOT_TESTED`, and `BLOCKED` items without repeating already-verified work unnecessarily; treat `context/STATE.md` as historical context and verify live state with `npm test` or `mis_get_me` (`GET`-only) before relying on it as current truth.
5. Report concisely where the prior session stopped, what is verified vs inherited, and the immediate next step.

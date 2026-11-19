# Verify & Evidence Playbook

Use after any workspace edit, code change, script update, or refactor before reporting completion.

1. Read and follow [.agents/skills/verify-evidence/SKILL.md](../skills/verify-evidence/SKILL.md).
2. Run syntax checks (`node --check`) across all active `.mjs` files under `src/`, `scripts/`, and `tests/`.
3. Run the deterministic unit & workspace contract test suite (`npm test` -> `tests/mcp.test.mjs` and `tests/workspace-contract.test.mjs`) after the final edit and observe exact pass/fail counts.
4. Run live read-only verification (`npm run test:live-readonly`, which enforces `readOnly: true` / `GET`-only) when target API checks are in scope; keep all `18` write tools (`readOnlyHint: false`) strictly `NOT_TESTED` against live `https://mis.oanhcuongdo.com` unless explicitly commanded for a real action.
5. Append verified milestone rows to [records/decisions.tsv](../../records/decisions.tsv) (`ts`, `phase`, `decision`, `why`, `evidence`, `result`).
6. Update [context/STATE.md](../../context/STATE.md) only when explicitly requested by the user or when completing an authorized refactor/pause handoff.

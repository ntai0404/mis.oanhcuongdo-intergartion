---
name: verify-evidence
description: >-
  Verify claims, code edits, MCP schemas, exported JSON snapshots, and test
  outputs directly against real artifacts on disk before reporting DONE.
---

# Verify & Evidence Standard

Never infer success from memory, file timestamps, or *"looks right"*. Follow [Verify & Evidence Playbook](../../playbooks/verify-and-evidence.md).

## 1. Direct Verification Rules

- **Syntax & unit/contract tests:** After the final edit, run `node --check` on active `.mjs` files and run `npm test` (`tests/mcp.test.mjs` + `tests/workspace-contract.test.mjs`), reporting exact observed pass/fail/skip counts.
- **Live checks (`GET`-only):** Run `npm run test:live-readonly` only with `readOnly: true` enforced; never claim live verification for any `readOnlyHint: false` tool unless explicitly tested with authorization.
- **Status Classification:** Label every check explicitly as `PASS`, `FAIL`, `PARTIAL`, `BLOCKED`, or `NOT_TESTED`.

## 2. Evidence & Decision Trail

- Record verified milestone outcomes in [records/decisions.tsv](../../../records/decisions.tsv) (`ts`, `phase`, `decision`, `why`, `evidence`, `result`).
- Cite exact clickable `file://` paths (forward slashes on Windows), line numbers, or command outputs directly observed in the current session.

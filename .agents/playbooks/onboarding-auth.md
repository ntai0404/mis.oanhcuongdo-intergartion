# Onboarding & Auth Playbook (`/browse-open` Native Chrome)

Use when setting up `MIS-matrix` on a new machine/clone, refreshing an expired `MIS_BEARER_TOKEN` (`--reauth`), or registering the `mis_matrix` MCP server (`"setup"`, `"cài đặt"`, `"hết hạn token"`, `"reauth"`, `"đăng ký mcp"`).

1. **Verify or Auto-Install Mandatory `/browse-open` Dependency First:**
   - Confirm Node.js `>= 22` and that [`browse-open`](https://github.com/ntai0404/browse-open) is installed (`.agents/skills/browse-open`, global skill dir, or `mcpServers.browse_open` in `~/.gemini/config/mcp_config.json`).
   - Running `node setup.mjs` automatically clones `https://github.com/ntai0404/browse-open.git` into `.agents/skills/browse-open` and registers `browse_open` in `mcp_config.json` when absent. If auto-install fails or `--skip-install` is used while `/browse-open` is missing, **STOP immediately** with exit code `2` (`MISSING_DEPENDENCY: browse-open`).
   - **NEVER** launch Chrome via Playwright as a fallback.
2. **Run Turnkey Setup (`node setup.mjs`):**
   - Run `node setup.mjs` (add `--reauth` to force token refresh, `--read-only` to register `MIS_READ_ONLY=1`, or `--cdp-url http://127.0.0.1:<port>` to attach to an already-open `/browse-open` Chrome session).
   - `setup.mjs` (backed by [src/onboarding.mjs](../../src/onboarding.mjs)):
     1. Checks Node.js `>= 22` and mandatory `/browse-open`.
     2. Initializes missing gitignored folders (`context/`, `records/`, `exports/`, `downloads/`, `reports/`) and starter templates non-destructively (never overwrites existing `.env.mis` or customized `context/*.md`).
     3. Reuses a valid `MIS_BEARER_TOKEN` in `.env.mis`, or coordinates with `/browse-open` (`doctor` / `open`) to open Native Chrome at `https://mis.oanhcuongdo.com/projects/` so the user signs in manually once, then extracts `access_token` read-only over CDP via [src/cdp-auth.mjs](../../src/cdp-auth.mjs) without printing the raw JWT.
     4. Merges `mis_matrix` into `~/.gemini/config/mcp_config.json` atomically while preserving all other MCP servers (`browse_open`, `webex_web`, etc.).
     5. Runs a live **read-only** stdio smoke test (`MIS_READ_ONLY=1`: `mis_health`, `mis_get_me`, `mis_list_projects`, plus asserting `mis_create_task` returns `READ_ONLY_MODE`).
3. **Handle Interactive `/browse-open` Prompts Cleanly:**
   - If `node setup.mjs` exits with code `3` (`BROWSE_OPEN_ACTION_REQUIRED`): invoke MCP `browse_open/doctor` (or `/browse-open`), present any numbered profile/port choices to the user and wait — never silently pick a profile/port, and never bypass login or CAPTCHAs. Once signed in, re-run `node setup.mjs --cdp-url http://127.0.0.1:<port>`.
   - Never run archived legacy `scripts/legacy/extract-bearer-and-user.mjs` (overwrites `.gitignore`).
4. **Finish Cleanly:**
   - Remind the user to reload/restart the IDE if it was already open so the newly configured `mis_matrix` MCP server starts.

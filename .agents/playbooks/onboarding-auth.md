# Onboarding & Auth Playbook

Use when setting up `.env.mis`, refreshing an expired `MIS_BEARER_TOKEN`, registering the `mis_matrix` MCP server, or onboarding on a fresh checkout (`"setup"`, `"cài đặt"`, `"hết hạn token"`, `"reauth"`, `"đăng ký mcp"`).

1. Check prerequisites (`Node >= 22`, [.env.example](../../.env.example), and local `.env.mis` presence without reading or printing raw token values).
2. If `.env.mis` is missing or bearer auth returns `401`:
   - Confirm whether local Chrome with `--remote-debugging-port` (default `http://127.0.0.1:63725`) is already signed in to `https://mis.oanhcuongdo.com`.
   - Run `mis_refresh_token_from_cdp` (backed by [src/cdp-auth.mjs](../../src/cdp-auth.mjs)) to read `access_token` cleanly into `.env.mis`; never log the raw JWT, never solve CAPTCHAs/login challenges automatically, and if not signed in ask the user to log in manually and report `BLOCKED`.
   - Never run archived legacy `scripts/legacy/extract-bearer-and-user.mjs` (overwrites `.gitignore`).
3. Verify read-only connectivity via `mis_health` and `mis_get_me` (confirm `success: true` and user identity/role without exposing raw tokens).
4. Provide explicit `agy mcp add` registration commands from [README.md](../../README.md) (`MIS_READ_ONLY=1` for read-only binding or default config) and modify `~/.gemini/config/mcp_config.json` only when the user explicitly confirms.

import { MisApiError } from './client.mjs';
import { parseEnvFile, saveEnvToken } from './config.mjs';
import { extractAccessTokenFromCdp, validateLoopbackEndpoint } from './cdp-auth.mjs';
import { findBrowseOpenInstallation, runBrowseOpenCli } from './onboarding.mjs';

const DEFAULT_EXPIRY_SKEW_SEC = 60;
const DEFAULT_NEAR_EXPIRY_SEC = 24 * 3600;

function formatVnTimestamp(ms) {
  const vn = new Date(ms + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}:${pad(vn.getUTCSeconds())} +07:00`;
}

/**
 * Decode JWT payload metadata without verifying signature or echoing the raw token.
 */
export function inspectJwt(token, nowMs = Date.now(), options = {}) {
  const skewSec = options.skewSeconds ?? DEFAULT_EXPIRY_SKEW_SEC;
  const nearExpirySec = options.nearExpirySeconds ?? DEFAULT_NEAR_EXPIRY_SEC;
  if (typeof token !== 'string' || !token.trim()) {
    return { present: false, validFormat: false, isExpired: true, isNearExpiry: true };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    // Non-JWT bearer string (e.g. unit test mock token) — do not mark locally expired
    return { present: true, validFormat: false, isExpired: false, isNearExpiry: false };
  }
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const iatMs = typeof payload.iat === 'number' ? payload.iat * 1000 : null;
    const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    const remainingSec = expMs !== null ? Math.floor((expMs - nowMs) / 1000) : null;
    const isExpired = remainingSec !== null ? remainingSec <= skewSec : false;
    const isNearExpiry = remainingSec !== null ? remainingSec <= nearExpirySec : false;
    return {
      present: true,
      validFormat: true,
      sub: payload.sub || null,
      role: payload.role || null,
      tokenType: payload.token_type || null,
      iat: payload.iat ?? null,
      exp: payload.exp ?? null,
      issuedAtVn: iatMs !== null ? formatVnTimestamp(iatMs) : null,
      expiresAtVn: expMs !== null ? formatVnTimestamp(expMs) : null,
      remainingSeconds: remainingSec,
      remainingDays: remainingSec !== null ? Math.round((remainingSec / 86400) * 10) / 10 : null,
      isExpired,
      isNearExpiry
    };
  } catch {
    return { present: true, validFormat: false, isExpired: false, isNearExpiry: false };
  }
}

async function isLoopbackCdpReachable(endpoint, fetchImpl) {
  try {
    const origin = validateLoopbackEndpoint(endpoint);
    const res = await fetchImpl(`${origin}/json/version`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.webSocketDebuggerUrl ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Discover an ALREADY-RUNNING Native Chrome CDP endpoint (read-only).
 * Never launches Chrome and never automates login.
 */
export async function findRunningNativeChromeCdp(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const finder = deps.findBrowseOpenInstallation || findBrowseOpenInstallation;
  const cliRunner = deps.runBrowseOpenCli || runBrowseOpenCli;

  if (config.cdpEndpoint) {
    const direct = await isLoopbackCdpReachable(config.cdpEndpoint, fetchImpl);
    if (direct) return { endpoint: direct, source: 'config_cdp_endpoint' };
  }

  try {
    const bo = finder(config.workspaceRoot || process.cwd(), { mcpConfigPath: deps.mcpConfigPath });
    if (!bo.installed || !bo.cliScript) return null;
    const doctor = cliRunner(bo.cliScript, ['doctor'], { nodeExecutable: bo.nodeExecutable, timeoutMs: 8000 });
    const instances = doctor?.data?.instances || [];
    for (const inst of instances) {
      if (inst?.port && String(inst.kind || '').toLowerCase() === 'chrome') {
        const cand = await isLoopbackCdpReachable(`http://127.0.0.1:${inst.port}`, fetchImpl);
        if (cand) return { endpoint: cand, source: 'browse_open_doctor_reuse' };
      }
    }
  } catch {
    // Non-fatal: CDP reuse is best-effort only
  }

  return null;
}

/**
 * API-first session manager for Matrix AI EDU.
 * - Valid tokens go directly to REST APIs with zero browser interaction.
 * - On missing/expired token or HTTP 401:
 *   1. Reloads .env.mis if another process refreshed the token.
 *   2. Reuses an already-running Native Chrome CDP session via /browse-open (read-only, never launches Chrome).
 *   3. Fails cleanly with SESSION_EXPIRED instructing the user to re-authenticate via /browse-open + `node setup.mjs --reauth`.
 */
export class AuthSessionManager {
  constructor(config, deps = {}) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
    this.parseEnv = deps.parseEnvFile || parseEnvFile;
    this.saveToken = deps.saveEnvToken || saveEnvToken;
    this.extractCdpToken = deps.extractAccessTokenFromCdp || extractAccessTokenFromCdp;
    this.findRunningCdp = deps.findRunningNativeChromeCdp || findRunningNativeChromeCdp;
    this.now = deps.now || (() => Date.now());
    this.cdpDeps = deps;
    this._inFlight = null;
  }

  needsPreemptiveRefresh(token) {
    if (!token) return false;
    const meta = inspectJwt(token, this.now());
    return meta.validFormat && meta.isExpired;
  }

  async _verifyTokenLive(token) {
    const meta = inspectJwt(token, this.now());
    if (meta.validFormat && meta.isExpired) return null;
    try {
      const res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(Math.min(this.config.timeoutMs || 15000, 10000)),
        redirect: 'manual'
      });
      if (!res.ok) return null;
      const body = await res.json();
      const user = body?.user || body;
      return user?.id ? { user, jwt: meta } : null;
    } catch {
      return null;
    }
  }

  async trySilentRecover(failedToken = '', reason = 'HTTP_401') {
    if (this._inFlight) return await this._inFlight;
    this._inFlight = this._performRecover(failedToken, reason);
    try {
      return await this._inFlight;
    } finally {
      this._inFlight = null;
    }
  }

  async _performRecover(failedToken, reason) {
    // Tier 1: Reload .env.mis in case another process/session already refreshed the token
    if (this.config.envFile) {
      try {
        const diskVars = this.parseEnv(this.config.envFile);
        const diskToken = diskVars.MIS_BEARER_TOKEN || '';
        if (diskToken && diskToken !== failedToken) {
          const verified = await this._verifyTokenLive(diskToken);
          if (verified) {
            this.config.token = diskToken;
            return {
              recovered: true,
              source: 'env_file_reload',
              token: diskToken,
              user: verified.user,
              jwt: verified.jwt
            };
          }
        }
      } catch {
        // ignore disk read errors and continue to Tier 2
      }
    }

    // Tier 2: Reuse an already-running Native Chrome CDP session (read-only, never launches Chrome)
    let cdpChecked = false;
    let cdpEndpoint = null;
    const running = await this.findRunningCdp(this.config, { ...this.cdpDeps, fetchImpl: this.fetchImpl });
    if (running?.endpoint) {
      cdpChecked = true;
      cdpEndpoint = running.endpoint;
      try {
        const res = await this.extractCdpToken(cdpEndpoint, `${this.config.baseUrl}/`, Math.min(this.config.timeoutMs || 10000, 10000));
        if (res?.token && res.token !== failedToken) {
          const verified = await this._verifyTokenLive(res.token);
          if (verified) {
            this.config.token = res.token;
            if (this.config.envFile) {
              this.saveToken(this.config.envFile, this.config.baseUrl, res.token);
            }
            return {
              recovered: true,
              source: running.source,
              cdpEndpoint,
              token: res.token,
              user: verified.user,
              jwt: verified.jwt
            };
          }
        }
      } catch {
        // Chrome tab not signed in or cookie expired -> fall through to explicit SESSION_EXPIRED
      }
    }

    return {
      recovered: false,
      reason,
      cdpChecked,
      cdpEndpoint,
      jwt: inspectJwt(failedToken, this.now())
    };
  }

  buildExpiredError(recoveryResult) {
    const expStr = recoveryResult?.jwt?.expiresAtVn ? ` (expired at ${recoveryResult.jwt.expiresAtVn})` : '';
    const detailMsg = recoveryResult?.cdpChecked
      ? `Checked running Native Chrome CDP (${recoveryResult.cdpEndpoint}) but no valid MIS session cookie was found.`
      : 'No running Native Chrome CDP session with an active MIS login was detected.';
    return new MisApiError(
      'SESSION_EXPIRED',
      `Matrix AI EDU session/Bearer token expired${expStr}. Backend does not provide a refresh_token endpoint (Google SSO uses access_type=online & prompt=select_account). ${detailMsg} Please sign in via /browse-open and run \`node setup.mjs --reauth\`.`,
      401,
      {
        reason: recoveryResult?.reason || 'SESSION_EXPIRED',
        cdpChecked: Boolean(recoveryResult?.cdpChecked),
        cdpEndpoint: recoveryResult?.cdpEndpoint || null,
        expiresAtVn: recoveryResult?.jwt?.expiresAtVn || null,
        actionRequired: 'Open https://mis.oanhcuongdo.com/projects/ via /browse-open, sign in manually, then run `node setup.mjs --reauth` (or `mis_refresh_token_from_cdp`).'
      }
    );
  }
}

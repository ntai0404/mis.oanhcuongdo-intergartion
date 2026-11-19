import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeBaseUrl, parseEnvFile, saveEnvToken } from './config.mjs';
import { extractAccessTokenFromCdp, validateLoopbackEndpoint } from './cdp-auth.mjs';

export const STARTER_MARKER = '<!-- MIS_MATRIX_STARTER -->';
export const BROWSE_OPEN_REPO_URL = 'https://github.com/ntai0404/browse-open';
export const DEFAULT_BASE_URL = 'https://mis.oanhcuongdo.com';
export const DEFAULT_BROWSE_OPEN_PORT = 4444;

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class BrowseOpenDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowseOpenDependencyError';
    this.code = 'MISSING_DEPENDENCY';
  }
}

export class BrowseOpenActionRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BrowseOpenActionRequiredError';
    this.code = 'BROWSE_OPEN_ACTION_REQUIRED';
  }
}

function nowVnString() {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())} ${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())} +07:00`;
}

function validateBrowseOpenDir(candidate) {
  if (!candidate) return null;
  let resolved;
  try {
    resolved = path.resolve(String(candidate).replace(/^~(?=$|[\\/])/, os.homedir()));
  } catch {
    return null;
  }
  const skillMd = path.join(resolved, 'SKILL.md');
  const cliScript = path.join(resolved, 'scripts', 'browse-open.mjs');
  const mcpScript = path.join(resolved, 'scripts', 'mcp-server.mjs');
  if (fs.existsSync(skillMd) && fs.existsSync(cliScript) && fs.existsSync(mcpScript)) {
    return {
      skillDir: resolved,
      skillMd,
      cliScript,
      mcpServerScript: mcpScript
    };
  }
  return null;
}

export function findBrowseOpenInstallation(root, options = {}) {
  const cfgPath = options.mcpConfigPath
    ? path.resolve(options.mcpConfigPath)
    : path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

  let mcpRegistered = false;
  const mcpCandidates = [];
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      const boSrv = cfg?.mcpServers?.browse_open;
      if (boSrv && typeof boSrv === 'object') {
        mcpRegistered = true;
        for (const arg of boSrv.args || []) {
          if (typeof arg === 'string' && arg.toLowerCase().endsWith('mcp-server.mjs')) {
            mcpCandidates.push(['mcp_config', path.resolve(path.dirname(path.dirname(arg)))]);
          }
        }
      }
    } catch {
      // ignore malformed config here; handled later
    }
  }

  const candidates = [];
  if (options.browseOpenDir !== undefined && options.browseOpenDir !== null && options.browseOpenDir !== '') {
    // Explicit override fails deterministically if invalid rather than silently falling back
    candidates.push(['arg', options.browseOpenDir]);
  } else {
    const envDir = String(process.env.BROWSE_OPEN_SKILL_DIR || '').trim();
    if (envDir) candidates.push(['env', envDir]);
    candidates.push(['workspace_skill', path.join(root, '.agents', 'skills', 'browse-open')]);
    candidates.push(['global_skill', path.join(os.homedir(), '.gemini', 'antigravity', 'skills', 'browse-open')]);
    candidates.push(['global_skill', path.join(os.homedir(), '.agents', 'skills', 'browse-open')]);
    candidates.push(...mcpCandidates);
  }

  let foundSource = null;
  let foundPaths = null;
  for (const [src, cand] of candidates) {
    const valid = validateBrowseOpenDir(cand);
    if (valid) {
      foundSource = src;
      foundPaths = valid;
      break;
    }
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const missingReasons = [];
  if (!foundPaths) {
    missingReasons.push(
      "Skill 'browse-open' (SKILL.md + scripts/browse-open.mjs + scripts/mcp-server.mjs) not found in .agents/skills/browse-open, ~/.gemini/antigravity/skills/browse-open, or mcp_config.json."
    );
  }
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    missingReasons.push(`Node.js >= 22 is required (detected ${process.version}).`);
  }

  const installInstructions = [
    `git clone ${BROWSE_OPEN_REPO_URL}.git .agents/skills/browse-open`,
    'agy mcp add browse_open -- node "<absolute-skill-dir>/scripts/mcp-server.mjs"'
  ];

  return {
    installed: Boolean(foundPaths) && nodeMajor >= 22,
    source: foundSource,
    skillDir: foundPaths?.skillDir || null,
    skillMd: foundPaths?.skillMd || null,
    cliScript: foundPaths?.cliScript || null,
    mcpServerScript: foundPaths?.mcpServerScript || null,
    mcpRegistered,
    nodeExecutable: process.execPath,
    nodeVersion: process.version,
    missingReasons,
    installInstructions
  };
}

export function requireBrowseOpenDependency(root, options = {}) {
  const info = findBrowseOpenInstallation(root, options);
  if (!info.installed) {
    const reasons = info.missingReasons.join('; ');
    const cmds = info.installInstructions.join('\n  ');
    throw new BrowseOpenDependencyError(
      `MISSING_DEPENDENCY: browse-open is required to open Native Chrome for MIS-matrix onboarding (no Playwright Chrome fallback is allowed).\n` +
      `Details: ${reasons}\n` +
      `Install from ${BROWSE_OPEN_REPO_URL}:\n  ${cmds}`
    );
  }
  return info;
}

/**
 * Clone upstream `browse-open` into `<root>/.agents/skills/browse-open` and optionally register
 * `browse_open` in `mcp_config.json` (preserving all existing MCP servers).
 */
export function installBrowseOpenSkill(root, options = {}) {
  const targetDir = path.join(root, '.agents', 'skills', 'browse-open');
  const gitRunner = options.gitRunner || ((args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true }));
  let cloned = false;

  if (!validateBrowseOpenDir(targetDir)) {
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
    const res = gitRunner(['clone', '--depth', '1', `${BROWSE_OPEN_REPO_URL}.git`, targetDir], root);
    if (res.error || res.status !== 0) {
      const errMsg = res.error ? res.error.message : String(res.stderr || res.stdout || '').trim().slice(0, 300);
      throw new BrowseOpenDependencyError(
        `MISSING_DEPENDENCY: Failed to auto-install browse-open from ${BROWSE_OPEN_REPO_URL} (${errMsg}).\n` +
        `Install manually:\n  git clone ${BROWSE_OPEN_REPO_URL}.git .agents/skills/browse-open`
      );
    }
    cloned = true;
  }

  const info = requireBrowseOpenDependency(root, {
    mcpConfigPath: options.mcpConfigPath,
    browseOpenDir: targetDir
  });

  let registeredBrowseOpenMcp = false;
  if (!options.skipMcpConfig && info.mcpServerScript) {
    const targetCfg = options.mcpConfigPath
      ? path.resolve(options.mcpConfigPath)
      : path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
    fs.mkdirSync(path.dirname(targetCfg), { recursive: true });
    let data = {};
    if (fs.existsSync(targetCfg)) {
      const raw = fs.readFileSync(targetCfg, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      }
    }
    if (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) {
      data.mcpServers = {};
    }
    if (!data.mcpServers.browse_open) {
      data.mcpServers.browse_open = {
        command: options.nodeExecutable || 'node',
        args: [info.mcpServerScript]
      };
      const tmpPath = `${targetCfg}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
      fs.renameSync(tmpPath, targetCfg);
      registeredBrowseOpenMcp = true;
    }
  }

  return { ...info, autoInstalled: cloned, registeredBrowseOpenMcp };
}

export function runBrowseOpenCli(cliScript, cliArgs, options = {}) {
  const nodeExe = options.nodeExecutable || process.execPath;
  const timeoutMs = options.timeoutMs || 30000;
  const proc = spawnSync(nodeExe, [cliScript, ...cliArgs], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true
  });
  if (proc.error) {
    throw new Error(`browse-open CLI failed to execute: ${proc.error.message}`);
  }
  const raw = String(proc.stdout || '').trim();
  if (!raw) {
    throw new Error(`browse-open CLI returned empty stdout (exit=${proc.status}): ${String(proc.stderr || '').trim().slice(0, 300)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`browse-open CLI returned non-JSON output (exit=${proc.status}): ${raw.slice(0, 300)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`browse-open CLI returned unexpected payload: ${raw.slice(0, 200)}`);
  }
  return { ...parsed, _returncode: proc.status };
}

async function isCdpAvailable(cdpUrl, fetchImpl = globalThis.fetch) {
  if (!cdpUrl) return false;
  try {
    const origin = validateLoopbackEndpoint(cdpUrl);
    const res = await fetchImpl(`${origin}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.webSocketDebuggerUrl);
  } catch {
    return false;
  }
}

export async function resolveBrowseOpenCdpEndpoint(root, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cliRunner = options.runBrowseOpenCli || runBrowseOpenCli;
  const targetUrl = options.targetUrl || `${DEFAULT_BASE_URL}/projects/`;

  const bo = requireBrowseOpenDependency(root, {
    mcpConfigPath: options.mcpConfigPath,
    browseOpenDir: options.browseOpenDir
  });

  const requestedCdp = String(options.cdpUrl || '').trim().replace(/\/+$/, '');
  if (requestedCdp && await isCdpAvailable(requestedCdp, fetchImpl)) {
    return {
      cdpUrl: validateLoopbackEndpoint(requestedCdp),
      reusedExistingCdp: true,
      openedViaBrowseOpen: false,
      browseOpen: bo
    };
  }

  const doctor = cliRunner(bo.cliScript, ['doctor'], { nodeExecutable: bo.nodeExecutable, timeoutMs: 30000 });
  const docData = doctor?.data || {};

  for (const inst of docData.instances || []) {
    const port = inst?.port;
    if (port && String(inst.kind || '').toLowerCase() === 'chrome') {
      const cand = `http://127.0.0.1:${port}`;
      if ((!requestedCdp || requestedCdp === cand) && await isCdpAvailable(cand, fetchImpl)) {
        return {
          cdpUrl: cand,
          reusedExistingCdp: true,
          openedViaBrowseOpen: false,
          browseOpen: bo,
          instance: inst
        };
      }
    }
  }

  const nextAct = docData.nextAction || {};
  const action = String(nextAct.action || '').toUpperCase();
  const actArgs = nextAct.arguments || {};

  if (action === 'OPEN' && actArgs.userDataDir && actArgs.profileDirectory) {
    const portStr = String(actArgs.port || DEFAULT_BROWSE_OPEN_PORT);
    const browserKind = String(actArgs.browser || 'chrome');
    const openCliArgs = [
      'open',
      '--browser', browserKind,
      '--user-data-dir', String(actArgs.userDataDir),
      '--profile-directory', String(actArgs.profileDirectory),
      '--port', portStr,
      '--timeout', '45000',
      '--url', targetUrl
    ];
    if (!options.quiet) {
      console.log(`[3/5] Opening Native Chrome via /browse-open (port ${portStr}) -> ${targetUrl} ...`);
    }
    let openRes;
    try {
      openRes = cliRunner(bo.cliScript, openCliArgs, { nodeExecutable: bo.nodeExecutable, timeoutMs: 55000 });
    } catch (err) {
      throw new BrowseOpenActionRequiredError(
        `browse-open open CLI failed or timed out (${err.message}). ` +
        `Inside an isolated Agent terminal, invoke MCP browse_open/open to open Native Chrome at ${targetUrl}, sign in, then re-run \`node setup.mjs --cdp-url http://127.0.0.1:${portStr}\`.`
      );
    }
    if (openRes?.status !== 'PASS') {
      const err = openRes?.error || {};
      throw new BrowseOpenActionRequiredError(
        `browse-open open did not succeed (status=${openRes?.status}, code=${err.code}, message=${err.message}). ` +
        `Invoke MCP browse_open/open (or run /browse-open) to open Native Chrome at ${targetUrl}, sign in, then re-run \`node setup.mjs --cdp-url http://127.0.0.1:<port>\`.`
      );
    }
    const endpoint = String(openRes?.data?.endpoint || `http://127.0.0.1:${portStr}`).replace(/\/+$/, '');
    if (!await isCdpAvailable(endpoint, fetchImpl)) {
      throw new Error(`browse-open reported PASS but CDP endpoint is unreachable: ${endpoint}`);
    }
    return {
      cdpUrl: validateLoopbackEndpoint(endpoint),
      reusedExistingCdp: false,
      openedViaBrowseOpen: true,
      browseOpen: bo
    };
  }

  throw new BrowseOpenActionRequiredError(
    `BROWSE_OPEN_ACTION_REQUIRED (${action || 'UNKNOWN'}): Native Chrome requires interactive profile/port selection through /browse-open before MIS-matrix onboarding can attach over CDP.\n` +
    `Next step: run /browse-open in your Agent to select your Chrome profile/port and open ${targetUrl}, sign in to Matrix AI EDU, then run \`node setup.mjs --cdp-url http://127.0.0.1:<port>\`.`
  );
}

export function ensureWorkspaceStructure(root, options = {}) {
  const envPath = options.envPath ? path.resolve(options.envPath) : path.join(root, '.env.mis');
  const dirs = [
    path.join(root, 'context', 'handoffs'),
    path.join(root, 'records'),
    path.join(root, 'exports'),
    path.join(root, 'downloads'),
    path.join(root, 'reports')
  ];

  const createdDirs = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      createdDirs.push(d);
    }
  }

  const createdFiles = [];
  const preservedFiles = [];

  if (!fs.existsSync(envPath)) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    const envExample = path.join(root, '.env.example');
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envPath);
    } else {
      fs.writeFileSync(envPath, `MIS_BASE_URL=${DEFAULT_BASE_URL}\nMIS_BEARER_TOKEN=\n`, 'utf8');
    }
    createdFiles.push(envPath);
  } else {
    preservedFiles.push(envPath);
  }

  const nowVn = nowVnString();
  const starters = new Map([
    [path.join(root, 'context', 'PROFILE.md'),
      `${STARTER_MARKER}\n# Operator & Companion Profile\n\n` +
      `- **Account:** *(populated after MIS-matrix sign-in)*\n` +
      `- **Target Service:** Matrix AI EDU (\`${DEFAULT_BASE_URL}\`)\n` +
      `- **Timezone:** \`Asia/Saigon\` (\`+07:00\`)\n` +
      `- **Safety Gates:** Strict read-only default; never run write MCP tools or commit/push Git without explicit instruction. Update \`context/\` only on explicit user request.\n`
    ],
    [path.join(root, 'context', 'STATE.md'),
      `${STARTER_MARKER}\n# MIS-Matrix Operational State Snapshot\n\n` +
      `> **HISTORICAL SNAPSHOT — NOT LIVE PROOF.** Verify live state via \`npm test\` or read-only \`mis_get_me\`. Update \`context/\` only when explicitly requested by the user.\n` +
      `> - **Last Updated:** \`${nowVn}\`\n` +
      `> - **Status:** Initialized via \`node setup.mjs\` (pending first live read-only verification)\n`
    ],
    [path.join(root, 'context', 'DECISIONS.md'),
      `${STARTER_MARKER}\n# Architectural & Operational Decisions\n\n` +
      `- **${nowVn.slice(0, 10)}:** Workspace initialized via \`node setup.mjs\`.\n`
    ],
    [path.join(root, 'context', 'domain-overview.md'),
      `${STARTER_MARKER}\n# Matrix AI EDU Domain Overview\n\n` +
      `- **Origin:** \`${DEFAULT_BASE_URL}\` (FastAPI SSR + REST API \`/api/v1/*\`)\n` +
      `- **MCP Server:** \`src/mcp-server.mjs\` (\`48\` tools: \`30\` read-only, \`18\` write/action; client-layer \`MIS_READ_ONLY\` gate)\n`
    ],
    [path.join(root, 'context', 'directory.md'),
      `${STARTER_MARKER}\n# Matrix Directory\n\n` +
      `Run read-only \`mis_list_projects\` or \`mis_collect_account_data\` after sign-in to inspect your accessible projects.\n`
    ],
    [path.join(root, 'records', 'decisions.tsv'),
      'ts\tphase\tdecision\twhy\tevidence\tresult\n'
    ]
  ]);

  for (const [filePath, content] of starters.entries()) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf8');
      createdFiles.push(filePath);
    } else {
      preservedFiles.push(filePath);
    }
  }

  return { createdDirs, createdFiles, preservedFiles, envPath };
}

function updateStarterContext(root, { user, projectsCount, smokeSummary }) {
  const nowVn = nowVnString();
  const profilePath = path.join(root, 'context', 'PROFILE.md');
  if (fs.existsSync(profilePath) && user) {
    const raw = fs.readFileSync(profilePath, 'utf8');
    if (raw.startsWith(STARTER_MARKER)) {
      const updated =
        `${STARTER_MARKER}\n# Operator & Companion Profile\n\n` +
        `- **Name:** ${user.full_name || 'Authenticated User'}\n` +
        `- **Account:** \`${user.email || 'unknown'}\` (User ID: \`${user.id || 'unknown'}\`, Role: \`${user.role || 'unknown'}\`)\n` +
        `- **Target Service:** Matrix AI EDU (\`${DEFAULT_BASE_URL}\`)\n` +
        `- **Timezone:** \`Asia/Saigon\` (\`+07:00\`)\n` +
        `- **Safety Gates:** Strict read-only default; never run write MCP tools or commit/push Git without explicit instruction. Update \`context/\` only on explicit user request.\n`;
      fs.writeFileSync(profilePath, updated, 'utf8');
    }
  }

  const statePath = path.join(root, 'context', 'STATE.md');
  if (fs.existsSync(statePath) && smokeSummary) {
    const raw = fs.readFileSync(statePath, 'utf8');
    if (raw.startsWith(STARTER_MARKER)) {
      const updated =
        `${STARTER_MARKER}\n# MIS-Matrix Operational State Snapshot\n\n` +
        `> **HISTORICAL SNAPSHOT — NOT LIVE PROOF.** Verify live state via \`npm test\` or read-only \`mis_get_me\`. Update \`context/\` only when explicitly requested by the user.\n` +
        `> - **Last Updated:** \`${nowVn}\`\n` +
        `> - **Status:** ${smokeSummary}\n` +
        (projectsCount !== undefined ? `> - **Accessible Projects at Setup:** \`${projectsCount}\`\n` : '');
      fs.writeFileSync(statePath, updated, 'utf8');
    }
  }
}

async function verifyBearerToken(baseUrl, token, fetchImpl = globalThis.fetch) {
  if (!token) return null;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      redirect: 'manual'
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = data?.user || data;
    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email || null,
      full_name: user.full_name || null,
      role: user.role || null
    };
  } catch {
    return null;
  }
}

export async function setupAuth(root, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cdpExtractor = options.extractAccessTokenFromCdp || extractAccessTokenFromCdp;
  const envPath = options.envPath ? path.resolve(options.envPath) : path.join(root, '.env.mis');
  const existingVars = parseEnvFile(envPath);
  const baseUrl = assertSafeBaseUrl(options.baseUrl || existingVars.MIS_BASE_URL || DEFAULT_BASE_URL);
  const existingToken = existingVars.MIS_BEARER_TOKEN || '';

  if (!options.forceReauth && existingToken) {
    const verifiedUser = await verifyBearerToken(baseUrl, existingToken, fetchImpl);
    if (verifiedUser) {
      updateStarterContext(root, { user: verifiedUser });
      return {
        status: 'REUSED_EXISTING_TOKEN',
        baseUrl,
        envPath,
        user: verifiedUser
      };
    }
  }

  if (options.skipLogin) {
    return {
      status: 'SKIPPED',
      baseUrl,
      envPath,
      hasToken: Boolean(existingToken)
    };
  }

  const cdpInfo = await resolveBrowseOpenCdpEndpoint(root, {
    cdpUrl: options.cdpUrl,
    mcpConfigPath: options.mcpConfigPath,
    browseOpenDir: options.browseOpenDir,
    targetUrl: `${baseUrl}/projects/`,
    fetchImpl,
    runBrowseOpenCli: options.runBrowseOpenCli,
    quiet: options.quiet
  });

  const loginTimeoutSec = Number(options.loginTimeout ?? 300);
  const deadline = Date.now() + Math.max(5, loginTimeoutSec) * 1000;
  let prompted = false;
  let extracted = null;

  while (Date.now() <= deadline) {
    try {
      const candidate = await cdpExtractor(cdpInfo.cdpUrl, `${baseUrl}/`, 10000);
      if (candidate?.token) {
        const verified = await verifyBearerToken(baseUrl, candidate.token, fetchImpl);
        if (verified) {
          extracted = { ...candidate, user: verified };
          break;
        }
      }
    } catch (err) {
      if (err?.code && !['TOKEN_NOT_FOUND', 'CDP_NO_TARGET'].includes(err.code)) {
        throw err;
      }
    }
    if (!prompted) {
      prompted = true;
      if (!options.quiet) {
        console.log(`[3/5] Please sign in to ${baseUrl} inside the Native Chrome window opened by /browse-open (waiting up to ${loginTimeoutSec}s)...`);
      }
    }
    if (options.singlePoll) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!extracted) {
    throw new BrowseOpenActionRequiredError(
      `LOGIN_TIMEOUT: access_token cookie was not detected in Native Chrome (${cdpInfo.cdpUrl}) within ${loginTimeoutSec}s. ` +
      `Sign in to ${baseUrl} in that Chrome window and re-run \`node setup.mjs --cdp-url ${cdpInfo.cdpUrl}\`.`
    );
  }

  saveEnvToken(envPath, baseUrl, extracted.token);
  updateStarterContext(root, { user: extracted.user });
  return {
    status: 'AUTHENTICATED_VIA_BROWSE_OPEN_CDP',
    baseUrl,
    envPath,
    cdpUrl: cdpInfo.cdpUrl,
    reusedExistingCdp: cdpInfo.reusedExistingCdp,
    openedViaBrowseOpen: cdpInfo.openedViaBrowseOpen,
    user: extracted.user
  };
}

export function configureMcpClient(root, options = {}) {
  const targetCfg = options.mcpConfigPath
    ? path.resolve(options.mcpConfigPath)
    : path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  const mcpScript = path.resolve(root, 'src', 'mcp-server.mjs');
  const nodeExe = options.nodeExecutable || 'node';

  fs.mkdirSync(path.dirname(targetCfg), { recursive: true });
  let data = {};
  if (fs.existsSync(targetCfg)) {
    const raw = fs.readFileSync(targetCfg, 'utf8').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
      }
    }
  }

  if (!data.mcpServers || typeof data.mcpServers !== 'object' || Array.isArray(data.mcpServers)) {
    data.mcpServers = {};
  }

  const existingEntry = data.mcpServers.mis_matrix;
  const prevEnv = (existingEntry && typeof existingEntry.env === 'object' && !Array.isArray(existingEntry.env))
    ? { ...existingEntry.env }
    : {};

  if (options.readOnly === true) {
    prevEnv.MIS_READ_ONLY = '1';
  }
  if (options.envPath) {
    prevEnv.MIS_ENV_FILE = path.resolve(options.envPath);
  }

  const nextEntry = {
    command: nodeExe,
    args: [mcpScript]
  };
  if (Object.keys(prevEnv).length > 0) {
    nextEntry.env = prevEnv;
  }

  const preservedServers = Object.keys(data.mcpServers).filter(k => k !== 'mis_matrix');
  data.mcpServers.mis_matrix = nextEntry;

  const tmpPath = `${targetCfg}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, targetCfg);

  return {
    mcpConfigPath: targetCfg,
    command: nodeExe,
    script: mcpScript,
    preservedServers,
    readOnly: prevEnv.MIS_READ_ONLY === '1'
  };
}

export async function runMcpSmokeTest(root, options = {}) {
  const serverEntry = path.resolve(root, 'src', 'mcp-server.mjs');
  const env = {
    ...process.env,
    MIS_READ_ONLY: '1'
  };
  if (options.envPath) env.MIS_ENV_FILE = path.resolve(options.envPath);
  if (options.baseUrl) env.MIS_BASE_URL = assertSafeBaseUrl(options.baseUrl);

  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mis_health', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mis_get_me', arguments: {} } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'mis_create_task', arguments: { project_id: 'smoke-guard', title: 'Blocked write' } } }
  ];

  const responses = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    const map = new Map();
    const timeoutMs = options.timeoutMs || 25000;
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`MCP stdio smoke test timed out after ${timeoutMs}ms. stderr=${stderrBuf.slice(0, 300)}`));
    }, timeoutMs);

    child.stderr.on('data', chunk => { stderrBuf += chunk.toString('utf8'); });
    child.stdout.on('data', chunk => {
      stdoutBuf += chunk.toString('utf8');
      let nl;
      while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) map.set(msg.id, msg);
        } catch {
          // ignore non-json noise
        }
      }
      if (map.size >= requests.length) {
        clearTimeout(timer);
        try { child.kill(); } catch {}
        resolve(map);
      }
    });

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    for (const req of requests) {
      child.stdin.write(JSON.stringify(req) + '\n');
    }
    child.stdin.end();
  });

  const init = responses.get(1)?.result;
  if (init?.serverInfo?.name !== 'mis_matrix') {
    throw new Error(`Unexpected MCP serverInfo: ${JSON.stringify(init?.serverInfo)}`);
  }

  const tools = responses.get(2)?.result?.tools || [];
  const healthRes = responses.get(3)?.result;
  const meRes = responses.get(4)?.result;
  const projRes = responses.get(5)?.result;
  const blockedWriteRes = responses.get(6)?.result;

  if (healthRes?.isError) {
    throw new Error(`mis_health failed: ${healthRes.content?.[0]?.text}`);
  }
  if (meRes?.isError) {
    throw new Error(`mis_get_me failed: ${meRes.content?.[0]?.text}`);
  }
  if (projRes?.isError) {
    throw new Error(`mis_list_projects failed: ${projRes.content?.[0]?.text}`);
  }
  if (!blockedWriteRes?.isError || blockedWriteRes?.structuredContent?.error?.code !== 'READ_ONLY_MODE') {
    throw new Error('MIS_READ_ONLY guard did not block mis_create_task during smoke test');
  }

  const meUser = meRes.structuredContent?.data?.user || meRes.structuredContent?.data || {};
  const projects = Array.isArray(projRes.structuredContent?.data) ? projRes.structuredContent.data : [];

  const summary = {
    serverName: init.serverInfo.name,
    toolsCount: tools.length,
    healthOk: true,
    user: {
      id: meUser.id || null,
      full_name: meUser.full_name || null,
      email: meUser.email || null,
      role: meUser.role || null
    },
    projectsCount: projects.length,
    readOnlyGuardVerified: true
  };

  updateStarterContext(root, {
    user: summary.user,
    projectsCount: summary.projectsCount,
    smokeSummary: `Setup & live read-only smoke test PASS (${summary.user.full_name || summary.user.id}, ${summary.projectsCount} projects, ${summary.toolsCount} tools, READ_ONLY guard verified)`
  });

  return summary;
}

export async function runSetup(options = {}) {
  const repoRoot = path.resolve(options.root || MODULE_ROOT);
  const quiet = Boolean(options.quiet);
  const log = msg => { if (!quiet) console.log(msg); };

  log('[1/5] Checking Node.js >= 22 and mandatory /browse-open dependency ...');
  let deps = findBrowseOpenInstallation(repoRoot, {
    mcpConfigPath: options.mcpConfigPath,
    browseOpenDir: options.browseOpenDir
  });
  let autoInstalledBrowseOpen = false;
  if (!deps.installed && !options.skipInstall && !options.browseOpenDir) {
    log('[1/5] Installing mandatory /browse-open skill into .agents/skills/browse-open ...');
    deps = installBrowseOpenSkill(repoRoot, {
      mcpConfigPath: options.mcpConfigPath,
      skipMcpConfig: Boolean(options.skipMcpConfig),
      gitRunner: options.gitRunner
    });
    autoInstalledBrowseOpen = Boolean(deps.autoInstalled);
  } else if (!deps.installed) {
    deps = requireBrowseOpenDependency(repoRoot, {
      mcpConfigPath: options.mcpConfigPath,
      browseOpenDir: options.browseOpenDir
    });
  }

  log('[2/5] Ensuring local workspace directories and starter templates (non-destructive) ...');
  const workspace = ensureWorkspaceStructure(repoRoot, { envPath: options.envPath });

  log('[3/5] Verifying Matrix AI EDU authentication (via existing .env.mis or /browse-open Native Chrome CDP) ...');
  const auth = await setupAuth(repoRoot, {
    envPath: workspace.envPath,
    baseUrl: options.baseUrl,
    cdpUrl: options.cdpUrl,
    mcpConfigPath: options.mcpConfigPath,
    browseOpenDir: options.browseOpenDir,
    forceReauth: Boolean(options.forceReauth),
    skipLogin: Boolean(options.skipLogin),
    loginTimeout: options.loginTimeout,
    fetchImpl: options.fetchImpl,
    extractAccessTokenFromCdp: options.extractAccessTokenFromCdp,
    runBrowseOpenCli: options.runBrowseOpenCli,
    singlePoll: options.singlePoll,
    quiet
  });

  let mcpConfig = null;
  if (!options.skipMcpConfig) {
    log('[4/5] Configuring mis_matrix MCP server (preserving all existing MCP servers) ...');
    mcpConfig = configureMcpClient(repoRoot, {
      mcpConfigPath: options.mcpConfigPath,
      readOnly: Boolean(options.readOnly),
      envPath: options.customEnvInMcp ? workspace.envPath : undefined
    });
  } else {
    log('[4/5] Skipping MCP client configuration (--skip-mcp-config) ...');
  }

  let smokeTest = null;
  let smokeError = null;
  if (!options.skipSmoke) {
    log('[5/5] Running read-only stdio MCP smoke test (MIS_READ_ONLY=1 enforced) ...');
    try {
      smokeTest = await runMcpSmokeTest(repoRoot, {
        envPath: workspace.envPath,
        baseUrl: options.baseUrl
      });
    } catch (err) {
      smokeError = err.message;
    }
  } else {
    log('[5/5] Skipping smoke test (--skip-smoke) ...');
  }

  const report = {
    repoRoot,
    dependencies: {
      nodeVersion: deps.nodeVersion,
      browseOpenSource: deps.source,
      browseOpenDir: deps.skillDir,
      browseOpenMcpRegistered: deps.mcpRegistered || Boolean(deps.registeredBrowseOpenMcp),
      autoInstalledBrowseOpen
    },
    workspace: {
      envPath: workspace.envPath,
      createdDirsCount: workspace.createdDirs.length,
      createdFilesCount: workspace.createdFiles.length,
      preservedFilesCount: workspace.preservedFiles.length
    },
    auth,
    mcpConfig,
    smokeTest,
    smokeError
  };

  if (!quiet) {
    console.log('\n=== MIS-Matrix Specific Agent Setup Summary ===');
    console.log(`Browse-open: PASS (${deps.source} -> ${deps.skillDir})`);
    console.log(`Auth status: ${auth.status}${auth.user?.full_name ? ` (${auth.user.full_name}, role=${auth.user.role})` : ''}`);
    if (mcpConfig) {
      console.log(`MCP config:  ${mcpConfig.mcpConfigPath} (preserved: ${mcpConfig.preservedServers.join(', ') || 'none'})`);
    }
    if (smokeTest) {
      console.log(`Smoke test:  PASS | tools=${smokeTest.toolsCount} | projects=${smokeTest.projectsCount} | readOnlyGuard=${smokeTest.readOnlyGuardVerified}`);
    } else if (options.skipSmoke) {
      console.log('Smoke test:  SKIPPED');
    } else {
      console.log(`Smoke test:  FAIL -> ${smokeError}`);
    }
  }

  return report;
}

export function parseCliArgs(argv = []) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-install') opts.skipInstall = true;
    else if (arg === '--skip-login') opts.skipLogin = true;
    else if (arg === '--skip-smoke') opts.skipSmoke = true;
    else if (arg === '--skip-mcp-config') opts.skipMcpConfig = true;
    else if (arg === '--reauth') opts.forceReauth = true;
    else if (arg === '--read-only') opts.readOnly = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--cdp-url' && i + 1 < argv.length) opts.cdpUrl = argv[++i];
    else if (arg === '--browse-open-dir' && i + 1 < argv.length) opts.browseOpenDir = argv[++i];
    else if (arg === '--mcp-config' && i + 1 < argv.length) opts.mcpConfigPath = argv[++i];
    else if (arg === '--env-file' && i + 1 < argv.length) opts.envPath = argv[++i];
    else if (arg === '--base-url' && i + 1 < argv.length) opts.baseUrl = argv[++i];
    else if (arg === '--login-timeout' && i + 1 < argv.length) opts.loginTimeout = Number(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return opts;
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    console.error(`[ERROR] ${err.message}`);
    return 1;
  }

  if (opts.help) {
    console.log(
      'Usage: node setup.mjs [options]\n\n' +
      'Options:\n' +
      '  --cdp-url <url>          Reuse running Native Chrome CDP endpoint opened via /browse-open\n' +
      '  --reauth                 Force re-authentication via /browse-open Native Chrome CDP\n' +
      '  --read-only              Register mis_matrix with MIS_READ_ONLY=1 in mcp_config.json\n' +
      '  --browse-open-dir <dir>  Explicit path to installed browse-open skill directory\n' +
      '  --mcp-config <path>      Override target mcp_config.json path\n' +
      '  --env-file <path>        Override target .env.mis path\n' +
      '  --base-url <url>         Override MIS_BASE_URL\n' +
      '  --login-timeout <sec>    Seconds to wait for manual sign-in (default 300)\n' +
      '  --skip-install           Do not auto-clone browse-open if missing (fail with exit 2)\n' +
      '  --skip-login             Skip /browse-open CDP login step\n' +
      '  --skip-mcp-config        Skip writing mcp_config.json\n' +
      '  --skip-smoke             Skip post-setup read-only MCP smoke test\n' +
      '  --json                   Output final report as JSON\n'
    );
    return 0;
  }

  try {
    const report = await runSetup({ ...opts, quiet: Boolean(opts.json) });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    }
    if (report.smokeError && !opts.skipSmoke) return 1;
    return 0;
  } catch (err) {
    if (err instanceof BrowseOpenDependencyError) {
      console.error(`\n[ERROR] ${err.message}`);
      return 2;
    }
    if (err instanceof BrowseOpenActionRequiredError) {
      console.error(`\n[ACTION REQUIRED] ${err.message}`);
      return 3;
    }
    console.error(`\n[ERROR] ${err.message}`);
    return 1;
  }
}

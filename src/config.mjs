import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const result = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

export function loadConfig(env = process.env) {
  const envFile = env.MIS_ENV_FILE || path.join(WORKSPACE_ROOT, '.env.mis');
  const fileVars = parseEnvFile(envFile);

  const baseUrlRaw = env.MIS_BASE_URL || fileVars.MIS_BASE_URL || 'https://mis.oanhcuongdo.com';
  const parsed = new URL(baseUrlRaw);
  const isLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error('MIS_BASE_URL must use https:// (or http:// on loopback for local tests)');
  }

  return {
    workspaceRoot: WORKSPACE_ROOT,
    envFile,
    baseUrl: parsed.origin,
    token: env.MIS_BEARER_TOKEN || fileVars.MIS_BEARER_TOKEN || '',
    cdpEndpoint: env.MIS_CDP_ENDPOINT || fileVars.MIS_CDP_ENDPOINT || 'http://127.0.0.1:63725',
    readOnly: ['1', 'true', 'yes'].includes(String(env.MIS_READ_ONLY || fileVars.MIS_READ_ONLY || '').toLowerCase()),
    timeoutMs: Number(env.MIS_TIMEOUT_MS || fileVars.MIS_TIMEOUT_MS || 20000),
    downloadsDir: path.join(WORKSPACE_ROOT, 'downloads'),
    exportsDir: env.MIS_EXPORTS_DIR || fileVars.MIS_EXPORTS_DIR || path.join(WORKSPACE_ROOT, 'exports')
  };
}

export function saveEnvToken(envFile, baseUrl, token) {
  const existing = parseEnvFile(envFile);
  const next = {
    ...existing,
    MIS_BASE_URL: baseUrl,
    MIS_BEARER_TOKEN: token
  };
  const content = [
    `# Updated ${new Date().toISOString()}`,
    ...Object.entries(next).map(([k, v]) => `${k}=${v}`)
  ].join('\n') + '\n';
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, content, 'utf8');
}

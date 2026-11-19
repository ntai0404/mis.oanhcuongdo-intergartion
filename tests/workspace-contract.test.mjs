import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolRegistry } from '../src/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectMarkdownFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

test('Required Specific Agent workspace structure exists and no placeholder .agents/agents directory exists', () => {
  const required = [
    'AGENTS.md',
    'README.md',
    'package.json',
    '.env.example',
    '.gitignore',
    'docs/WORKSPACE_STRUCTURE.md',
    'docs/MIS-API-REFERENCE.md',
    'docs/MIS-UI-AND-MCP-BLUEPRINT.md',
    'scripts/README.md',
    'scripts/analyze-openapi.mjs',
    'scripts/build-docs.mjs',
    'scripts/legacy/MANIFEST.md',
    '.agents/playbooks/collect-account-data.md',
    '.agents/playbooks/investigation.md',
    '.agents/playbooks/onboarding-auth.md',
    '.agents/playbooks/verify-and-evidence.md',
    '.agents/playbooks/session-pickup.md',
    '.agents/playbooks/pause-safely.md',
    '.agents/skills/mis-account-collector/SKILL.md',
    '.agents/skills/mis-project-ops/SKILL.md',
    '.agents/skills/verify-evidence/SKILL.md',
    'src/mcp-server.mjs',
    'src/tools.mjs',
    'src/collector.mjs',
    'src/client.mjs',
    'src/config.mjs',
    'src/cdp-auth.mjs'
  ];

  for (const rel of required) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `Missing required file: ${rel}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, '.agents', 'agents')), false, 'Placeholder .agents/agents should not exist');
});

test('AGENTS.md respects size budget and declares poteto-mode routing and guardrails', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(Buffer.byteLength(raw, 'utf8') <= 12000, 'AGENTS.md exceeds 12,000 byte budget');

  const requiredTokens = [
    'poteto-mode',
    'figure-it-out',
    'Read-Playbook-First',
    'Playbook / Skill Verification Gate',
    'On-Demand Personal Context Policy',
    '.agents/playbooks/collect-account-data.md',
    '.agents/playbooks/investigation.md',
    '.agents/playbooks/onboarding-auth.md',
    '.agents/playbooks/verify-and-evidence.md',
    '.agents/playbooks/session-pickup.md',
    '.agents/playbooks/pause-safely.md',
    '.agents/skills/mis-account-collector/SKILL.md',
    '.agents/skills/mis-project-ops/SKILL.md',
    '.agents/skills/verify-evidence/SKILL.md',
    '/skill',
    'BLOCKED'
  ];

  for (const token of requiredTokens) {
    assert.ok(raw.includes(token), `AGENTS.md missing required token: ${token}`);
  }
});

test('All relative markdown links across handbook, playbooks, skills, scripts docs, and structure docs resolve on disk', () => {
  const mdFiles = [
    path.join(ROOT, 'AGENTS.md'),
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'docs', 'WORKSPACE_STRUCTURE.md'),
    path.join(ROOT, 'scripts', 'README.md'),
    path.join(ROOT, 'scripts', 'legacy', 'MANIFEST.md'),
    ...collectMarkdownFiles(path.join(ROOT, '.agents'))
  ];

  const broken = [];
  for (const file of mdFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim();
      if (/^(https?:|file:|mailto:|#)/i.test(rawTarget)) continue;
      const cleanTarget = rawTarget.split('#')[0];
      if (!cleanTarget) continue;
      const resolved = path.resolve(path.dirname(file), cleanTarget);
      const relFromRoot = path.relative(ROOT, resolved);
      const top = relFromRoot.split(path.sep)[0];
      if (['context', 'exports', 'downloads', 'records', 'reports'].includes(top) && !fs.existsSync(path.join(ROOT, top))) {
        continue;
      }
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(ROOT, file)} -> ${rawTarget}`);
      }
    }
  }
  assert.deepEqual(broken, [], `Broken relative links: ${broken.join(', ')}`);
});

test('MCP tool registry invariants match expected 48-tool contract', () => {
  const reg = createToolRegistry({}, {});
  assert.equal(reg.tools.length, 48);
  const ro = reg.tools.filter(t => t.annotations?.readOnlyHint === true);
  const rw = reg.tools.filter(t => t.annotations?.readOnlyHint !== true);
  assert.equal(ro.length, 30);
  assert.equal(rw.length, 18);

  for (const tool of reg.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must disallow extra args`);
  }

  for (const collectorName of ['mis_collect_account_data', 'mis_get_user_logs']) {
    const t = reg.tools.find(item => item.name === collectorName);
    assert.ok(t, `Missing tool ${collectorName}`);
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }
});

test('Active scripts use portable paths and .gitignore protects sensitive/local directories', () => {
  for (const scriptName of ['analyze-openapi.mjs', 'build-docs.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', scriptName), 'utf8');
    assert.equal(/c:[\\\/]+aaa\s*tai/i.test(src), false, `${scriptName} must not hardcode machine-specific drive path`);
  }

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim());
  for (const rule of ['.env', '.env.*', '!.env.example', 'secrets/', 'node_modules/', 'downloads/', 'exports/', 'context/', 'records/', 'reports/', 'scripts/legacy/*.mjs']) {
    assert.ok(gitignore.includes(rule), `.gitignore missing ${rule}`);
  }
});

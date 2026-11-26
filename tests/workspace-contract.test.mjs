import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolRegistry } from '../src/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectMarkdownFiles(dir) {
  const externalBrowseOpen = path.resolve(ROOT, '.agents', 'skills', 'browse-open');
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (path.resolve(full) === externalBrowseOpen) continue;
    if (entry.isDirectory()) results.push(...collectMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

test('Required Specific Agent workspace structure exists and no placeholder .agents/agents directory exists', () => {
  const required = [
    'AGENTS.md',
    'README.md',
    'setup.mjs',
    'package.json',
    '.env.example',
    '.gitignore',
    'docs/SPECIFIC_AGENT_TEMPLATE.md',
    'docs/WORKSPACE_STRUCTURE.md',
    'docs/MIS-API-REFERENCE.md',
    'docs/MIS-UI-AND-MCP-BLUEPRINT.md',
    'scripts/README.md',
    'scripts/analyze-openapi.mjs',
    'scripts/build-docs.mjs',
    'scripts/legacy/MANIFEST.md',
    '.agents/playbooks/checkin.md',
    '.agents/playbooks/collect-account-data.md',
    '.agents/playbooks/investigation.md',
    '.agents/playbooks/onboarding-auth.md',
    '.agents/playbooks/verify-and-evidence.md',
    '.agents/playbooks/session-pickup.md',
    '.agents/playbooks/pause-safely.md',
    '.agents/skills/mis-account-collector/SKILL.md',
    '.agents/skills/mis-project-ops/SKILL.md',
    '.agents/skills/verify-evidence/SKILL.md',
    'src/onboarding.mjs',
    'src/auth-manager.mjs',
    'src/mcp-server.mjs',
    'src/tools.mjs',
    'src/data-access.mjs',
    'src/collector.mjs',
    'src/client.mjs',
    'src/config.mjs',
    'src/cdp-auth.mjs',
    'tests/mcp.test.mjs',
    'tests/workspace-contract.test.mjs',
    'tests/onboarding.test.mjs',
    'tests/auth-session.test.mjs',
    'tests/live-readonly.test.mjs'
  ];

  for (const rel of required) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `Missing required file: ${rel}`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, '.agents', 'agents')), false, 'Placeholder .agents/agents should not exist');
});

test('Global mcp_config.json matches live src/mcp-server.mjs when configured for this checkout', () => {
  const cfgPath = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
  if (!fs.existsSync(cfgPath)) return;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return;
  }
  const srv = cfg?.mcpServers?.mis_matrix;
  if (!srv || !Array.isArray(srv.args) || !srv.args[0]) return;
  const configured = path.resolve(String(srv.args[0]));
  if (path.resolve(path.dirname(path.dirname(configured))) !== ROOT) return;
  assert.equal(configured, path.resolve(ROOT, 'src', 'mcp-server.mjs'));
  assert.equal(fs.existsSync(configured), true);
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
    '.agents/playbooks/checkin.md',
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
    path.join(ROOT, 'docs', 'SPECIFIC_AGENT_TEMPLATE.md'),
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

test('MCP tool registry invariants match expected 49-tool contract', () => {
  const reg = createToolRegistry({}, {});
  assert.equal(reg.tools.length, 49);
  const ro = reg.tools.filter(t => t.annotations?.readOnlyHint === true);
  const rw = reg.tools.filter(t => t.annotations?.readOnlyHint !== true);
  assert.equal(ro.length, 31);
  assert.equal(rw.length, 18);

  for (const tool of reg.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must disallow extra args`);
  }

  for (const collectorName of ['mis_collect_account_data', 'mis_get_user_logs', 'mis_query_my_tasks']) {
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
  for (const rule of ['.env', '.env.*', '!.env.example', 'secrets/', 'node_modules/', '.local/', 'downloads/', 'exports/', 'context/', 'records/', 'reports/', 'scripts/legacy/*.mjs', '.agents/skills/browse-open/']) {
    assert.ok(gitignore.includes(rule), `.gitignore missing ${rule}`);
  }
});

function unwrapArgPath(rawVal) {
  let s = String(rawVal || '').trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      s = String(JSON.parse(s));
    } catch {
      s = s.slice(1, -1);
    }
  }
  return s.replace(/\\/g, '/').toLowerCase();
}

export function auditPlaybookReadBeforeExecution(transcriptEvents, expectedPlaybook) {
  const targetSuffix = `.agents/playbooks/${expectedPlaybook}`.toLowerCase();
  let playbookReadStep = null;
  let firstExecStep = null;

  for (let idx = 0; idx < transcriptEvents.length; idx++) {
    const ev = transcriptEvents[idx] || {};
    const step = Number.isInteger(ev.step_index) ? ev.step_index : idx;
    for (const tc of ev.tool_calls || []) {
      const tname = tc?.name || '';
      const args = tc?.args || {};
      if (tname === 'read_file') {
        const normPath = unwrapArgPath(args.Path);
        if (normPath.endsWith(targetSuffix)) {
          if (playbookReadStep === null) playbookReadStep = step;
          continue;
        }
        if (!normPath.includes('/.agents/') && !normPath.endsWith('/agents.md')) {
          if (firstExecStep === null) firstExecStep = [step, `read_file:${normPath}`];
        }
      } else if (['run_command', 'call_mcp_tool', 'edit_file', 'write_file', 'send_message'].includes(tname)) {
        if (firstExecStep === null) firstExecStep = [step, tname];
      }
    }
  }

  if (playbookReadStep === null) {
    return [false, `UNREAD_CLAIMED_PLAYBOOK: ${expectedPlaybook} was never opened via read_file`];
  }
  if (firstExecStep !== null && playbookReadStep > firstExecStep[0]) {
    return [
      false,
      `READ_AFTER_EXECUTION: ${expectedPlaybook} read at step ${playbookReadStep} after ${firstExecStep[1]} at step ${firstExecStep[0]}`
    ];
  }
  return [true, `PASS: ${expectedPlaybook} read at step ${playbookReadStep} before execution`];
}

test('Transcript Read-Playbook-First audit catches unread and late-read playbook regressions', () => {
  const unreadEvents = [
    { step_index: 1, tool_calls: [{ name: 'read_file', args: { Path: '"c:\\\\repo\\\\AGENTS.md"' } }] },
    { step_index: 3, tool_calls: [{ name: 'read_file', args: { Path: '"c:\\\\repo\\\\tests\\\\workspace-contract.test.mjs"' } }] },
    { step_index: 5, tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test' } }] },
    { step_index: 7, tool_calls: [{ name: 'send_message', args: { Message: 'Applied investigation.md' } }] }
  ];
  const [okUnread, msgUnread] = auditPlaybookReadBeforeExecution(unreadEvents, 'investigation.md');
  assert.equal(okUnread, false);
  assert.ok(msgUnread.includes('UNREAD_CLAIMED_PLAYBOOK'));

  const lateEvents = [
    { step_index: 1, tool_calls: [{ name: 'run_command', args: { CommandLine: 'dir' } }] },
    { step_index: 3, tool_calls: [{ name: 'read_file', args: { Path: 'c:/repo/.agents/playbooks/checkin.md' } }] }
  ];
  const [okLate, msgLate] = auditPlaybookReadBeforeExecution(lateEvents, 'checkin.md');
  assert.equal(okLate, false);
  assert.ok(msgLate.includes('READ_AFTER_EXECUTION'));

  const validEvents = [
    { step_index: 1, tool_calls: [{ name: 'read_file', args: { Path: '"c:\\\\repo\\\\AGENTS.md"' } }] },
    { step_index: 3, tool_calls: [{ name: 'read_file', args: { Path: '"c:\\\\repo\\\\.agents\\\\playbooks\\\\investigation.md"' } }] },
    { step_index: 5, tool_calls: [{ name: 'read_file', args: { Path: '"c:\\\\repo\\\\tests\\\\workspace-contract.test.mjs"' } }] },
    { step_index: 7, tool_calls: [{ name: 'run_command', args: { CommandLine: 'npm test' } }] }
  ];
  const [okValid, msgValid] = auditPlaybookReadBeforeExecution(validEvents, 'investigation.md');
  assert.equal(okValid, true);
  assert.ok(msgValid.startsWith('PASS:'));
});

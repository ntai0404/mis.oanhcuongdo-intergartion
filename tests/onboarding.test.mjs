import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { saveEnvToken } from '../src/config.mjs';
import {
  BrowseOpenActionRequiredError,
  BrowseOpenDependencyError,
  STARTER_MARKER,
  configureMcpClient,
  ensureWorkspaceStructure,
  findBrowseOpenInstallation,
  installBrowseOpenSkill,
  main,
  requireBrowseOpenDependency,
  resolveBrowseOpenCdpEndpoint,
  runSetup,
  setupAuth
} from '../src/onboarding.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFakeBrowseOpenSkill(baseDir, doctorPayload = null) {
  const skillDir = path.join(baseDir, 'browse-open');
  fs.mkdirSync(path.join(skillDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: browse-open\n---\n', 'utf8');
  fs.writeFileSync(path.join(skillDir, 'scripts', 'mcp-server.mjs'), '// stub\n', 'utf8');
  const payload = doctorPayload || {
    status: 'PASS',
    command: 'doctor',
    data: { instances: [], nextAction: { action: 'ASK_SOURCE_PROFILE' } }
  };
  fs.writeFileSync(
    path.join(skillDir, 'scripts', 'browse-open.mjs'),
    `console.log(JSON.stringify(${JSON.stringify(payload)}));\n`,
    'utf8'
  );
  return skillDir;
}

async function withMockMisServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
    await handler(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}

test('requireBrowseOpenDependency fails loudly with MISSING_DEPENDENCY (exit 2) when browse-open is missing', async t => {
  const tmp = makeTempDir('mis-onb-missing-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const emptyMcpCfg = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(emptyMcpCfg, JSON.stringify({ mcpServers: {} }), 'utf8');
  const missingDir = path.join(tmp, 'does-not-exist');

  assert.throws(
    () => requireBrowseOpenDependency(tmp, { mcpConfigPath: emptyMcpCfg, browseOpenDir: missingDir }),
    err => err instanceof BrowseOpenDependencyError && err.code === 'MISSING_DEPENDENCY' && err.message.includes('browse-open')
  );

  const exitCode = await main([
    '--browse-open-dir', missingDir,
    '--mcp-config', emptyMcpCfg,
    '--skip-login',
    '--skip-smoke'
  ]);
  assert.equal(exitCode, 2);
});

test('findBrowseOpenInstallation detects browse-open from workspace skill dir or mcp_config.json', t => {
  const tmp = makeTempDir('mis-onb-find-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const wsSkillRoot = path.join(tmp, 'repo', '.agents', 'skills');
  fs.mkdirSync(wsSkillRoot, { recursive: true });
  const wsSkillDir = createFakeBrowseOpenSkill(wsSkillRoot);

  const emptyMcpCfg = path.join(tmp, 'empty-mcp.json');
  fs.writeFileSync(emptyMcpCfg, JSON.stringify({ mcpServers: {} }), 'utf8');

  const fromWs = findBrowseOpenInstallation(path.join(tmp, 'repo'), { mcpConfigPath: emptyMcpCfg });
  assert.equal(fromWs.installed, true);
  assert.equal(fromWs.source, 'workspace_skill');
  assert.equal(fromWs.skillDir, wsSkillDir);

  // Also test detection via mcp_config.json when workspace skill dir is absent
  const otherRepo = path.join(tmp, 'other-repo');
  fs.mkdirSync(otherRepo, { recursive: true });
  const cfgWithBo = path.join(tmp, 'with-bo-mcp.json');
  fs.writeFileSync(cfgWithBo, JSON.stringify({
    mcpServers: {
      browse_open: { command: 'node', args: [path.join(wsSkillDir, 'scripts', 'mcp-server.mjs')] }
    }
  }), 'utf8');

  const fromMcp = findBrowseOpenInstallation(otherRepo, { mcpConfigPath: cfgWithBo, browseOpenDir: wsSkillDir });
  assert.equal(fromMcp.installed, true);
  assert.equal(fromMcp.mcpRegistered, true);
});

test('resolveBrowseOpenCdpEndpoint raises BROWSE_OPEN_ACTION_REQUIRED when doctor asks for profile selection', async t => {
  const tmp = makeTempDir('mis-onb-action-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const skillDir = createFakeBrowseOpenSkill(tmp, {
    status: 'PASS',
    command: 'doctor',
    data: { instances: [], nextAction: { action: 'ASK_SOURCE_PROFILE' } }
  });
  const emptyMcpCfg = path.join(tmp, 'mcp.json');
  fs.writeFileSync(emptyMcpCfg, JSON.stringify({ mcpServers: {} }), 'utf8');

  await assert.rejects(
    () => resolveBrowseOpenCdpEndpoint(tmp, { browseOpenDir: skillDir, mcpConfigPath: emptyMcpCfg }),
    err => err instanceof BrowseOpenActionRequiredError && err.code === 'BROWSE_OPEN_ACTION_REQUIRED'
  );
});

test('ensureWorkspaceStructure creates starter files once and preserves existing .env.mis and customized context on re-run', t => {
  const tmp = makeTempDir('mis-onb-ws-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tmp, '.env.example'), 'MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=\n', 'utf8');

  const first = ensureWorkspaceStructure(tmp);
  assert.ok(first.createdFiles.includes(path.join(tmp, '.env.mis')));
  assert.ok(fs.existsSync(path.join(tmp, 'context', 'PROFILE.md')));
  assert.ok(fs.existsSync(path.join(tmp, 'context', 'STATE.md')));
  assert.ok(fs.existsSync(path.join(tmp, 'records', 'decisions.tsv')));
  assert.ok(fs.readFileSync(path.join(tmp, 'context', 'PROFILE.md'), 'utf8').startsWith(STARTER_MARKER));

  // Simulate user customization
  const customEnv = 'MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=secret-token-kept\n';
  const customProfile = '# Custom Operator Profile\nDo not overwrite me.\n';
  fs.writeFileSync(path.join(tmp, '.env.mis'), customEnv, 'utf8');
  fs.writeFileSync(path.join(tmp, 'context', 'PROFILE.md'), customProfile, 'utf8');

  const second = ensureWorkspaceStructure(tmp);
  assert.equal(second.createdFiles.length, 0);
  assert.equal(fs.readFileSync(path.join(tmp, '.env.mis'), 'utf8'), customEnv);
  assert.equal(fs.readFileSync(path.join(tmp, 'context', 'PROFILE.md'), 'utf8'), customProfile);
});

test('configureMcpClient merges mis_matrix while preserving all other MCP servers and existing env', t => {
  const tmp = makeTempDir('mis-onb-mcp-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cfgPath = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({
    customTopKey: 'keep-me',
    mcpServers: {
      browse_open: { command: 'node', args: ['/path/to/browse-open/scripts/mcp-server.mjs'] },
      webex_web: { command: 'python', args: ['/path/to/webex_web_mcp.py'], env: { WEBEX_CDP_URL: 'http://127.0.0.1:4444' } }
    }
  }, null, 2), 'utf8');

  const res1 = configureMcpClient(tmp, { mcpConfigPath: cfgPath, readOnly: true });
  assert.deepEqual(res1.preservedServers.sort(), ['browse_open', 'webex_web']);
  assert.equal(res1.readOnly, true);

  const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(written.customTopKey, 'keep-me');
  assert.deepEqual(written.mcpServers.browse_open.args, ['/path/to/browse-open/scripts/mcp-server.mjs']);
  assert.equal(written.mcpServers.webex_web.env.WEBEX_CDP_URL, 'http://127.0.0.1:4444');
  assert.equal(written.mcpServers.mis_matrix.command, 'node');
  assert.equal(written.mcpServers.mis_matrix.args[0], path.resolve(tmp, 'src', 'mcp-server.mjs'));
  assert.equal(written.mcpServers.mis_matrix.env.MIS_READ_ONLY, '1');

  // Re-run without --read-only preserves existing env key
  configureMcpClient(tmp, { mcpConfigPath: cfgPath });
  const written2 = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.equal(written2.mcpServers.mis_matrix.env.MIS_READ_ONLY, '1');
  assert.ok(written2.mcpServers.browse_open);
  assert.ok(written2.mcpServers.webex_web);
});

test('runSetup executes end-to-end against local mock MIS server, enforces READ_ONLY smoke test, and is idempotent on re-run', async t => {
  const tmp = makeTempDir('mis-onb-e2e-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // Create isolated workspace copying src/ so stdio spawn runs from isolated root
  const repoRoot = path.join(tmp, 'repo');
  fs.cpSync(path.resolve('src'), path.join(repoRoot, 'src'), { recursive: true });
  fs.copyFileSync(path.resolve('.env.example'), path.join(repoRoot, '.env.example'));
  fs.copyFileSync(path.resolve('package.json'), path.join(repoRoot, 'package.json'));

  const skillDir = createFakeBrowseOpenSkill(tmp);
  const mcpCfgPath = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(mcpCfgPath, JSON.stringify({
    mcpServers: {
      browse_open: { command: 'node', args: [path.join(skillDir, 'scripts', 'mcp-server.mjs')] },
      webex_web: { command: 'python', args: ['webex.py'] }
    }
  }, null, 2), 'utf8');

  const mock = await withMockMisServer((req, res) => {
    assert.equal(req.method, 'GET', 'Setup smoke test must never send non-GET requests');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url === '/api/v1/auth/me') {
      if (req.headers.authorization !== 'Bearer mock-jwt-123') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ detail: 'Unauthorized' }));
      }
      return res.end(JSON.stringify({ success: true, user: { id: 'u-mock', email: 'mock@example.com', full_name: 'Mock User', role: 'instructor' } }));
    }
    if (req.url === '/api/v1/projects/') {
      return res.end(JSON.stringify([{ id: 'p-1', name: 'Demo Project' }]));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'Not found' }));
  });
  t.after(() => mock.close());

  const envPath = path.join(repoRoot, '.env.mis');
  fs.writeFileSync(envPath, `MIS_BASE_URL=${mock.baseUrl}\nMIS_BEARER_TOKEN=mock-jwt-123\n`, 'utf8');

  const rep1 = await runSetup({
    root: repoRoot,
    envPath,
    baseUrl: mock.baseUrl,
    mcpConfigPath: mcpCfgPath,
    browseOpenDir: skillDir,
    quiet: true
  });

  assert.equal(rep1.auth.status, 'REUSED_EXISTING_TOKEN');
  assert.equal(rep1.smokeError, null);
  assert.equal(rep1.smokeTest.toolsCount, 49);
  assert.equal(rep1.smokeTest.projectsCount, 1);
  assert.equal(rep1.smokeTest.readOnlyGuardVerified, true);
  assert.ok(fs.readFileSync(path.join(repoRoot, 'context', 'PROFILE.md'), 'utf8').includes('Mock User'));

  // Customize context/PROFILE.md and re-run setup -> must NOT overwrite custom context or other MCPs
  const customProfile = '# Operator Custom\nKeep intact.\n';
  fs.writeFileSync(path.join(repoRoot, 'context', 'PROFILE.md'), customProfile, 'utf8');

  const rep2 = await runSetup({
    root: repoRoot,
    envPath,
    baseUrl: mock.baseUrl,
    mcpConfigPath: mcpCfgPath,
    browseOpenDir: skillDir,
    quiet: true
  });

  assert.equal(rep2.auth.status, 'REUSED_EXISTING_TOKEN');
  assert.equal(rep2.smokeError, null);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'context', 'PROFILE.md'), 'utf8'), customProfile);
  const finalCfg = JSON.parse(fs.readFileSync(mcpCfgPath, 'utf8'));
  assert.ok(finalCfg.mcpServers.browse_open);
  assert.ok(finalCfg.mcpServers.webex_web);
  assert.equal(finalCfg.mcpServers.mis_matrix.args[0], path.resolve(repoRoot, 'src', 'mcp-server.mjs'));
});

test('installBrowseOpenSkill clones browse-open into workspace and registers browse_open MCP preserving existing servers', t => {
  const tmp = makeTempDir('mis-onb-install-bo-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'clean-repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const cfgPath = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ mcpServers: { existing_srv: { command: 'node', args: ['a.js'] } } }), 'utf8');

  const gitCalls = [];
  const res = installBrowseOpenSkill(repoRoot, {
    mcpConfigPath: cfgPath,
    gitRunner: args => {
      gitCalls.push(args);
      const targetDir = args[args.length - 1];
      createFakeBrowseOpenSkill(path.dirname(targetDir));
      return { status: 0, stdout: 'cloned', stderr: '' };
    }
  });

  assert.equal(res.autoInstalled, true);
  assert.equal(res.registeredBrowseOpenMcp, true);
  assert.equal(gitCalls.length, 1);
  assert.ok(gitCalls[0].includes('https://github.com/ntai0404/browse-open.git'));
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(cfg.mcpServers.existing_srv);
  assert.ok(cfg.mcpServers.browse_open);
  assert.equal(cfg.mcpServers.browse_open.args[0], path.join(repoRoot, '.agents', 'skills', 'browse-open', 'scripts', 'mcp-server.mjs'));
});

test('setupAuth follows browse-open doctor OPEN -> CDP access_token -> /auth/me -> .env.mis preserving custom keys', async t => {
  const tmp = makeTempDir('mis-onb-cdp-open-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  ensureWorkspaceStructure(repoRoot);

  const envPath = path.join(repoRoot, '.env.mis');
  fs.writeFileSync(envPath, 'MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=\nCUSTOM_FLAG=keep_me\n', 'utf8');
  const skillDir = createFakeBrowseOpenSkill(tmp);
  const emptyMcp = path.join(tmp, 'mcp.json');
  fs.writeFileSync(emptyMcp, JSON.stringify({ mcpServers: {} }), 'utf8');

  const mock = await withMockMisServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/me' && req.headers.authorization === 'Bearer fresh-cdp-jwt') {
      return res.end(JSON.stringify({ success: true, user: { id: 'u-new', email: 'newuser@example.org', full_name: 'Clean User', role: 'student' } }));
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ detail: 'Unauthorized' }));
  });
  t.after(() => mock.close());

  const cliCalls = [];
  let cdpOpened = false;
  const authRes = await setupAuth(repoRoot, {
    envPath,
    baseUrl: mock.baseUrl,
    browseOpenDir: skillDir,
    mcpConfigPath: emptyMcp,
    quiet: true,
    singlePoll: true,
    fetchImpl: async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:4444/json/version')) {
        return { ok: cdpOpened, json: async () => (cdpOpened ? { webSocketDebuggerUrl: 'ws://127.0.0.1:4444/devtools/browser/1' } : {}) };
      }
      return await fetch(url, init);
    },
    runBrowseOpenCli: (_script, args) => {
      cliCalls.push(args);
      if (args[0] === 'doctor') {
        return {
          status: 'PASS',
          data: {
            instances: [],
            nextAction: { action: 'OPEN', arguments: { browser: 'chrome', userDataDir: 'C:\\tmp\\prof', profileDirectory: 'Default', port: 4444 } }
          }
        };
      }
      if (args[0] === 'open') {
        cdpOpened = true;
        return { status: 'PASS', data: { endpoint: 'http://127.0.0.1:4444' } };
      }
      throw new Error('Unexpected CLI args: ' + JSON.stringify(args));
    },
    extractAccessTokenFromCdp: async endpoint => {
      assert.equal(endpoint, 'http://127.0.0.1:4444');
      return { token: 'fresh-cdp-jwt', domain: 'mis.oanhcuongdo.com', expires: 1999999999 };
    }
  });

  assert.equal(authRes.status, 'AUTHENTICATED_VIA_BROWSE_OPEN_CDP');
  assert.equal(authRes.openedViaBrowseOpen, true);
  assert.equal(authRes.user.full_name, 'Clean User');
  assert.equal(cliCalls[0][0], 'doctor');
  assert.equal(cliCalls[1][0], 'open');
  const savedEnv = fs.readFileSync(envPath, 'utf8');
  assert.ok(savedEnv.includes('MIS_BEARER_TOKEN=fresh-cdp-jwt'));
  assert.ok(savedEnv.includes('CUSTOM_FLAG=keep_me'));
  assert.ok(fs.readFileSync(path.join(repoRoot, 'context', 'PROFILE.md'), 'utf8').includes('Clean User'));
});

test('setup.mjs and src/*.mjs contain zero author-specific personal paths, accounts, or ephemeral ports', () => {
  const files = ['setup.mjs', ...fs.readdirSync('src').filter(f => f.endsWith('.mjs')).map(f => path.join('src', f))];
  const forbidden = [
    'ntai' + '04042004',
    'Nguyễn ' + 'Xuân',
    'AAA ' + 'TAI',
    'ZALO_' + 'MESS',
    'sea' + 'bank.com.vn',
    '63' + '725'
  ];
  for (const rel of files) {
    const raw = fs.readFileSync(rel, 'utf8');
    for (const marker of forbidden) {
      assert.equal(raw.includes(marker), false, `Author-specific marker "${marker}" found in ${rel}`);
    }
  }
});

test('resolveBrowseOpenCdpEndpoint converts CLI open timeout/failure into BROWSE_OPEN_ACTION_REQUIRED (exit 3)', async t => {
  const tmp = makeTempDir('mis-onb-cli-timeout-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const skillDir = createFakeBrowseOpenSkill(tmp);
  const emptyMcpCfg = path.join(tmp, 'mcp.json');
  fs.writeFileSync(emptyMcpCfg, JSON.stringify({ mcpServers: {} }), 'utf8');

  await assert.rejects(
    () => resolveBrowseOpenCdpEndpoint(tmp, {
      browseOpenDir: skillDir,
      mcpConfigPath: emptyMcpCfg,
      quiet: true,
      runBrowseOpenCli: (_script, args) => {
        if (args[0] === 'doctor') {
          return {
            status: 'PASS',
            data: {
              instances: [],
              nextAction: {
                action: 'OPEN',
                arguments: { browser: 'chrome', userDataDir: 'C:\\tmp\\agis', profileDirectory: 'Profile 1', port: '4444' }
              }
            }
          };
        }
        throw new Error('browse-open CLI failed to execute: ETIMEDOUT');
      }
    }),
    err => err instanceof BrowseOpenActionRequiredError &&
      err.code === 'BROWSE_OPEN_ACTION_REQUIRED' &&
      err.message.includes('browse_open/open')
  );
});

test('setupAuth rejects non-HTTPS remote baseUrl before network calls and saveEnvToken blocks newline injection', async t => {
  const tmp = makeTempDir('mis-onb-sec-');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const envFile = path.join(tmp, '.env.mis');
  fs.writeFileSync(envFile, 'MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=abc\n', 'utf8');

  let fetchCalled = false;
  await assert.rejects(
    () => setupAuth(tmp, {
      envPath: envFile,
      baseUrl: 'http://evil.example.com',
      fetchImpl: async () => { fetchCalled = true; throw new Error('Should never fetch non-HTTPS remote URL'); }
    }),
    /https/
  );
  assert.equal(fetchCalled, false);

  assert.throws(
    () => saveEnvToken(envFile, 'https://mis.oanhcuongdo.com', 'tok\nMIS_READ_ONLY=0'),
    /control character/
  );
  assert.throws(
    () => saveEnvToken(envFile, 'http://evil.example.com', 'tok'),
    /https/
  );
});

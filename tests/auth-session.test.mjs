import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createMcpServer } from '../src/mcp-server.mjs';
import { inspectJwt } from '../src/auth-manager.mjs';

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.mock_signature`;
}

async function withAuthMockServer(validTokenSet) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization || null });
    res.setHeader('Content-Type', 'application/json');
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!validTokenSet.has(bearer)) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ detail: 'Invalid or expired token' }));
    }
    if (req.url === '/api/v1/auth/me') {
      return res.end(JSON.stringify({ success: true, user: { id: 'u1', email: 'u1@example.com', full_name: 'Test User', role: 'instructor' } }));
    }
    if (req.url === '/api/v1/projects/') {
      return res.end(JSON.stringify([{ id: 'p1', name: 'Project 1' }]));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'Not found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}

test('Valid token uses API-first fast path with zero Chrome CDP interaction', async t => {
  const nowSec = Math.floor(Date.now() / 1000);
  const validJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 60, exp: nowSec + 86400 * 25 });
  const mock = await withAuthMockServer(new Set([validJwt]));
  t.after(() => mock.close());

  let cdpLookupCalls = 0;
  let cdpExtractCalls = 0;
  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: validJwt, cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '' },
    deps: {
      findRunningNativeChromeCdp: async () => { cdpLookupCalls++; return null; },
      extractAccessTokenFromCdp: async () => { cdpExtractCalls++; return { token: '' }; }
    }
  });

  const res = await srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } });
  assert.equal(res.result.isError, false);
  assert.equal(res.result.structuredContent.data.length, 1);
  assert.equal(cdpLookupCalls, 0);
  assert.equal(cdpExtractCalls, 0);
  assert.equal(mock.requests.length, 1);

  const meta = inspectJwt(validJwt);
  assert.equal(meta.isExpired, false);
  assert.equal(meta.isNearExpiry, false);
  assert.ok(meta.remainingDays >= 24);
});

test('Expired in-memory token recovers silently by reloading updated .env.mis without opening Chrome', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-auth-env-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 86400 * 31, exp: nowSec - 300 });
  const freshJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 10, exp: nowSec + 86400 * 30 });
  const envFile = path.join(tmp, '.env.mis');
  fs.writeFileSync(envFile, `MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=${freshJwt}\n`, 'utf8');

  const mock = await withAuthMockServer(new Set([freshJwt]));
  t.after(() => mock.close());

  let cdpLookupCalls = 0;
  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: expiredJwt, cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile },
    deps: {
      findRunningNativeChromeCdp: async () => { cdpLookupCalls++; return null; }
    }
  });

  const res = await srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } });
  assert.equal(res.result.isError, false);
  assert.equal(res.result.structuredContent.data[0].id, 'p1');
  assert.equal(cdpLookupCalls, 0, 'Must not touch Chrome CDP when .env.mis already has a fresh token');
});

test('HTTP 401 / revoked token recovers by reusing running Native Chrome CDP (/browse-open), saves .env.mis, and retries once', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-auth-cdp-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const nowSec = Math.floor(Date.now() / 1000);
  const revokedJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 3600, exp: nowSec + 86400 * 20 });
  const renewedJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 5, exp: nowSec + 86400 * 30 });
  const envFile = path.join(tmp, '.env.mis');
  fs.writeFileSync(envFile, `MIS_BASE_URL=https://mis.oanhcuongdo.com\nMIS_BEARER_TOKEN=${revokedJwt}\n`, 'utf8');

  const mock = await withAuthMockServer(new Set([renewedJwt]));
  t.after(() => mock.close());

  let extractCalls = 0;
  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: revokedJwt, cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile },
    deps: {
      findRunningNativeChromeCdp: async () => ({ endpoint: 'http://127.0.0.1:4444', source: 'browse_open_doctor_reuse' }),
      extractAccessTokenFromCdp: async () => {
        extractCalls++;
        return { token: renewedJwt, domain: 'mis.oanhcuongdo.com', expires: nowSec + 86400 * 30 };
      }
    }
  });

  // Fire 3 concurrent requests -> single-flight must invoke CDP extractor only once
  const results = await Promise.all([
    srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } }),
    srv.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } }),
    srv.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } })
  ]);

  for (const r of results) {
    assert.equal(r.result.isError, false);
    assert.equal(r.result.structuredContent.data[0].id, 'p1');
  }
  assert.equal(extractCalls, 1, 'Concurrent 401s must deduplicate CDP recovery via single-flight lock');
  assert.ok(fs.readFileSync(envFile, 'utf8').includes(`MIS_BEARER_TOKEN=${renewedJwt}`));
});

test('Session expired everywhere returns SESSION_EXPIRED (401) with clear /browse-open reauth action without launching Chrome', async t => {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 86400 * 35, exp: nowSec - 3600 });
  const mock = await withAuthMockServer(new Set());
  t.after(() => mock.close());

  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: expiredJwt, cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '' },
    deps: {
      findRunningNativeChromeCdp: async () => ({ endpoint: 'http://127.0.0.1:4444', source: 'browse_open_doctor_reuse' }),
      extractAccessTokenFromCdp: async () => ({ token: expiredJwt, domain: 'mis.oanhcuongdo.com', expires: nowSec - 3600 })
    }
  });

  const res = await srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_list_projects', arguments: {} } });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.structuredContent.error.code, 'SESSION_EXPIRED');
  assert.equal(res.result.structuredContent.error.status, 401);
  assert.ok(res.result.structuredContent.error.message.includes('/browse-open'));
  assert.ok(res.result.structuredContent.error.message.includes('node setup.mjs --reauth'));
  assert.equal(mock.requests.length, 0, 'Preemptively expired token with no valid CDP cookie should not spam API');
});

test('MIS_READ_ONLY still blocks write tools before auth recovery', async t => {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiredJwt = makeJwt({ sub: 'u1', role: 'instructor', token_type: 'access', iat: nowSec - 86400 * 35, exp: nowSec - 3600 });
  let cdpCalls = 0;

  const srv = createMcpServer({
    config: { baseUrl: 'https://mis.oanhcuongdo.com', token: expiredJwt, cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '' },
    deps: {
      findRunningNativeChromeCdp: async () => { cdpCalls++; return null; }
    }
  });

  const res = await srv.dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'mis_create_task', arguments: { project_id: 'p1', title: 'Blocked' } }
  });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.structuredContent.error.code, 'READ_ONLY_MODE');
  assert.equal(cdpCalls, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from '../src/mcp-server.mjs';
import { loadConfig } from '../src/config.mjs';

const serverEntry = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url));

async function withMockServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks)
    });
    await handler(req, res, requests[requests.length - 1]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}

test('MCP initialize and tools/list expose well-formed schemas', async () => {
  const srv = createMcpServer({
    config: { baseUrl: 'https://mis.oanhcuongdo.com', token: 'dummy', cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '', downloadsDir: os.tmpdir() }
  });
  const init = await srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(init.result.serverInfo.name, 'mis_matrix');

  const listed = await srv.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = listed.result.tools.map(t => t.name);
  assert.ok(names.includes('mis_get_me'));
  assert.ok(names.includes('mis_list_projects'));
  assert.ok(names.includes('mis_submit_task_report'));
  assert.ok(names.includes('mis_raw_api'));
  for (const tool of listed.result.tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('history uses +07:00, explicit system transitions and the logged actor', async () => {
  const logged = { id: 'system', is_system_log: true, content: "Reviewer đã chuyển trạng thái sang 'DONE'", user_id: 'reviewer', created_at: '2026-11-19T17:05:00Z' };
  const task = {
    id: 't1', status: 'IN_PROGRESS', assignee_id: 'worker', parent_id: 'parent',
    comments: [
      logged,
      { ...logged, id: 'manual', is_system_log: false, user_id: 'worker' },
      { ...logged, id: 'report-log', content: "Reviewer đã nộp báo cáo kết quả: yêu cầu chuyển trạng thái sang 'DONE'" },
      { ...logged, id: 'assignment-log', content: 'Reviewer đã giao việc cho Worker.' },
      { ...logged, id: 'previous-day', created_at: '2026-11-19T16:59:00Z' }
    ],
    reports: [{ user_id: 'worker', updated_at: logged.created_at }],
    checklists: [{ completed_by_id: 'worker', is_completed: true, updated_at: logged.created_at }]
  };
  const srv = createMcpServer({
    config: {},
    authManager: null,
    client: { request: async (method, path) => {
      assert.equal(method, 'GET');
      if (path.endsWith('/tasks/t1')) return task;
      if (path.endsWith('/tasks/')) return [task];
      if (path.endsWith('/projects/p1')) return { id: 'p1', name: 'Project' };
      assert.fail(path);
    } }
  });
  const call = async (name, args) => (await srv.dispatch({
    jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args }
  })).result.structuredContent;

  const history = await call('mis_get_task', { project_id: 'p1', task_id: 't1', view: 'history', date_from: '2026-11-20', date_to: '2026-11-20' });
  assert.equal(history.data.current_status, 'IN_PROGRESS');
  assert.deepEqual(history.data.transitions.items.map(row => [row.source_id, row.actor_user_id]), [['system', 'reviewer']]);
  assert.equal(history.data.transitions.items[0].actor_name, 'Reviewer');
  assert.equal(history.data.transitions.items[0].timestamp_vn, '2026-11-20 00:05:00 +07:00');
  assert.deepEqual(history.data.assignment_events.items.map(row => row.source_id), ['assignment-log']);
  assert.equal(history.data.assignment_events.items[0].actor_name, 'Reviewer');
  const detail = await call('mis_get_task', { project_id: 'p1', task_id: 't1' });
  assert.deepEqual(detail.data.comment_counts, { total: 5, manual: 1, system_log: 4, unclassified: 0 });

  const progress = await call('mis_query_my_tasks', { project_id: 'p1', user_id: 'worker', date_vn: '2026-11-20' });
  assert.equal(progress.data.dateAnalysis.workedOnDateCount, 1);
  assert.equal(progress.data.dateAnalysis.worked_on_date[0].evidence_count, 1);
  assert.equal(progress.data.dateAnalysis.completedOnDateCount, 1);
  assert.equal(progress.data.dateAnalysis.completed_on_date[0].done_transitions[0].actor_user_id, 'reviewer');

  const todayAlias = await call('mis_query_my_tasks', { project_id: 'p1', user_id: 'worker', date_vn: 'today' });
  assert.match(todayAlias.data.dateAnalysis.date_vn, /^\d{4}-\d{2}-\d{2}$/);

  const multiDay = await call('mis_query_my_tasks', {
    project_id: 'p1', user_id: 'worker', date_from: '2026-11-19', date_to: '2026-11-20'
  });
  assert.ok(multiDay.data.periodAnalysis.worked_on_date[0].evidence.length <= 3);

  const activity = await call('mis_get_user_logs', { project_id: 'p1', user_id: 'worker', date_from: '2026-11-20', include_feed_only_events: false });
  assert.deepEqual(activity.data.logs.map(row => row.id), ['manual']);

  const invalid = await call('mis_get_task', { project_id: 'p1', task_id: 't1', view: 'history', date_from: '2026-02-30' });
  assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
  const children = await call('mis_list_tasks', { project_id: 'p1', compact: true, parent_id: 'parent', limit: 1 });
  assert.equal(children.data.total, 1);
  assert.equal(children.data.items[0].id, 't1');
  assert.equal(children.data.items[0].comments, undefined);

  const autoCompact = await call('mis_list_tasks', { project_id: 'p1', parent_id: 'parent', limit: 1 });
  assert.equal(autoCompact.ok, true);
  assert.equal(autoCompact.data.items[0].id, 't1');
  assert.equal(autoCompact.data.items[0].comments, undefined);

  const badUncompact = await call('mis_list_tasks', { project_id: 'p1', compact: false, parent_id: 'parent' });
  assert.equal(badUncompact.error.code, 'INVALID_ARGUMENT');
});

test('Q5 and Q6 use one MCP call per question with raw counts and targeted task detail', async () => {
  const comment = (id, action, is_system_log = true) => ({
    id, user_id: 'reviewer', content: `Reviewer đã ${action}`, is_system_log, created_at: '2026-11-19T17:05:00Z'
  });
  const task = {
    id: 't1', title: 'Verify integration', status: 'DONE', deadline: '2026-11-12T00:00:00Z',
    comments: [
      comment('review', "chuyển trạng thái sang 'INTERNAL_REVIEW'"),
      comment('mentor', "chuyển trạng thái sang 'MENTOR_REVIEW'"),
      comment('done', "chuyển trạng thái sang 'DONE'"),
      ...Array.from({ length: 10 }, (_, i) => comment(`check-${i}`, 'đánh dấu hoàn thành checklist')),
      ...Array.from({ length: 7 }, (_, i) => comment(`submit-${i}`, 'nộp báo cáo kết quả'))
    ],
    checklists: Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, title: `Check ${i}`, is_completed: true })),
    reports: Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, report_text: 'evidence '.repeat(3000), file_name: 'proof.log' }))
  };
  const paths = [];
  const srv = createMcpServer({
    config: { readOnly: true },
    authManager: null,
    client: { request: async (method, path) => {
      assert.equal(method, 'GET');
      paths.push(path);
      if (path === '/api/v1/projects/') return [{ id: 'p1', name: 'Integration' }];
      if (path === '/api/v1/projects/p1/tasks/') return [{ id: 't1', title: task.title }, { id: 't2', title: task.title + ' follow-up' }];
      if (path === '/api/v1/projects/p1/tasks/t1') return task;
      assert.fail(path);
    } }
  });
  const call = async args => (await srv.dispatch({
    jsonrpc: '2.0', id: 'task', method: 'tools/call', params: { name: 'mis_get_task', arguments: args }
  })).result;
  const q5 = await call({ project_name: 'integration', task_title: task.title, view: 'summary' });
  assert.equal(q5.isError, false, q5.structuredContent.error?.message);
  assert.deepEqual(paths.splice(0), ['/api/v1/projects/', '/api/v1/projects/p1/tasks/', '/api/v1/projects/p1/tasks/t1']);
  assert.deepEqual(q5.structuredContent.data.comment_counts, { total: 20, manual: 0, system_log: 20, unclassified: 0 });
  assert.equal(q5.structuredContent.data.checklists.length, 7);
  assert.equal(q5.structuredContent.data.reports.length, 3);
  assert.equal(q5.structuredContent.data.deadline_vn, '2026-11-12 07:00:00 +07:00');
  assert.equal(q5.structuredContent.data.reports[0].file_name, 'proof.log');
  assert.equal(q5.structuredContent.data.reports[0].report_text_truncated, true);

  const byId = { project_id: 'p1', task_id: 't1' };
  const q6 = await call({ ...byId, view: 'review', limit: 1 });
  assert.equal(q6.isError, false, q6.structuredContent.error?.message);
  assert.deepEqual(paths.splice(0), ['/api/v1/projects/p1/tasks/t1']);
  const review = q6.structuredContent.data;
  assert.equal(review.transitions.total, 2);
  assert.equal(review.transitions.next_offset, 1);
  assert.equal(review.transitions.items[0].actor_name, 'Reviewer');
  assert.equal(review.transitions.items[0].timestamp_vn, '2026-11-20 00:05:00 +07:00');
  assert.equal(review.checklist_events, undefined);
  assert.equal(review.assignment_events, undefined);

  const grouped = await call({ ...byId, view: 'history' });
  const logGroups = grouped.structuredContent.data;
  assert.equal(logGroups.transitions.total + logGroups.assignment_events.total + logGroups.checklist_events.total, 13);

  const full = await call(byId);
  assert.deepEqual(full.structuredContent.data.comments, task.comments);
  assert.deepEqual(full.structuredContent.data.reports, task.reports);
  assert.deepEqual(full.structuredContent.data.comment_counts, q5.structuredContent.data.comment_counts);
  assert.deepEqual(JSON.parse(full.content[0].text), full.structuredContent);
  assert.ok(q5.content[0].text.length < full.content[0].text.length / 4);

  const ambiguous = await call({ project_id: 'p1', task_title: 'Verify', view: 'summary' });
  assert.equal(ambiguous.structuredContent.error.code, 'AMBIGUOUS_TASK');
  assert.deepEqual(paths, ['/api/v1/projects/p1/tasks/t1', '/api/v1/projects/p1/tasks/t1', '/api/v1/projects/p1/tasks/']);
});

test('MCP attaches Bearer token on requests and supports read/write routing against local mock', async t => {
  const mock = await withMockServer(async (req, res, captured) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/auth/me') {
      res.end(JSON.stringify({ success: true, user: { id: 'u1', role: 'instructor' } }));
      return;
    }
    if (req.url === '/api/v1/projects/p1/tasks/' && req.method === 'POST') {
      res.end(JSON.stringify({ id: 't1', ...JSON.parse(captured.body.toString('utf8')) }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'Not found' }));
  });
  t.after(() => mock.close());

  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: 'test-jwt-secret', cdpEndpoint: 'http://127.0.0.1:4444', readOnly: false, timeoutMs: 5000, envFile: '', downloadsDir: os.tmpdir() }
  });

  const meRes = await srv.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mis_get_me', arguments: {} } });
  assert.equal(meRes.result.isError, false);
  assert.equal(meRes.result.structuredContent.data.user.id, 'u1');
  assert.equal(mock.requests[0].headers.authorization, 'Bearer test-jwt-secret');

  const createRes = await srv.dispatch({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'mis_create_task', arguments: { project_id: 'p1', title: 'Mock task', estimated_hours: 2 } }
  });
  assert.equal(createRes.result.isError, false);
  assert.equal(createRes.result.structuredContent.data.title, 'Mock task');
});

test('MIS_READ_ONLY blocks all non-GET tools and raw mutations before network call', async t => {
  const mock = await withMockServer((_req, res) => {
    res.statusCode = 500;
    res.end('Should never reach server');
  });
  t.after(() => mock.close());

  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: 'test-jwt-secret', cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '', downloadsDir: os.tmpdir() }
  });

  const r1 = await srv.dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'mis_create_task', arguments: { project_id: 'p1', title: 'Blocked' } }
  });
  assert.equal(r1.result.isError, true);
  assert.equal(r1.result.structuredContent.error.code, 'READ_ONLY_MODE');

  const r2 = await srv.dispatch({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'mis_raw_api', arguments: { method: 'PATCH', path: '/api/v1/projects/p1/tasks/t1', body: { status: 'DONE' } } }
  });
  assert.equal(r2.result.isError, true);
  assert.equal(r2.result.structuredContent.error.code, 'READ_ONLY_MODE');
  assert.equal(mock.requests.length, 0);
});

test('Path traversal and unknown arguments are rejected cleanly', async () => {
  const srv = createMcpServer({
    config: { baseUrl: 'https://mis.oanhcuongdo.com', token: 'dummy', cdpEndpoint: 'http://127.0.0.1:4444', readOnly: true, timeoutMs: 5000, envFile: '', downloadsDir: os.tmpdir() }
  });

  const badSegment = await srv.dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'mis_get_project', arguments: { project_id: '../admin' } }
  });
  assert.equal(badSegment.result.isError, true);
  assert.equal(badSegment.result.structuredContent.error.code, 'INVALID_ARGUMENT');

  const badRaw = await srv.dispatch({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'mis_raw_api', arguments: { method: 'GET', path: '/admin/users' } }
  });
  assert.equal(badRaw.result.isError, true);
  assert.equal(badRaw.result.structuredContent.error.code, 'INVALID_PATH');

  const unknownArg = await srv.dispatch({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'mis_get_me', arguments: { extra: 'x' } }
  });
  assert.equal(unknownArg.result.isError, true);
  assert.equal(unknownArg.result.structuredContent.error.code, 'UNKNOWN_ARGUMENT');
});

test('mis_submit_task_report sends multipart FormData cleanly to mock server', async t => {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mis-mcp-')), 'proof.log');
  fs.writeFileSync(tmpFile, 'sample log output\n', 'utf8');
  t.after(() => fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true }));

  const mock = await withMockServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, contentType: req.headers['content-type'] }));
  });
  t.after(() => mock.close());

  const srv = createMcpServer({
    config: { baseUrl: mock.baseUrl, token: 'tok', cdpEndpoint: 'http://127.0.0.1:4444', readOnly: false, timeoutMs: 5000, envFile: '', downloadsDir: os.tmpdir() }
  });

  const res = await srv.dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'mis_submit_task_report',
      arguments: { project_id: 'p1', task_id: 't1', report_text: 'Done', file_path: tmpFile }
    }
  });
  assert.equal(res.result.isError, false);
  assert.ok(res.result.structuredContent.data.contentType.startsWith('multipart/form-data'));
});

test('stdio MCP process responds to initialize and tools/list', async () => {
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, MIS_READ_ONLY: '1', MIS_BEARER_TOKEN: 'dummy' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('stdio timeout')); }, 5000);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      if (stdout.trim().split('\n').length >= 2) {
        clearTimeout(timer);
        child.kill();
        resolve(stdout.trim().split('\n').map(l => JSON.parse(l)));
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  });
  assert.equal(out[0].result.serverInfo.name, 'mis_matrix');
  assert.ok(out[1].result.tools.length >= 30);
});

test('loadConfig rejects non-HTTPS remote URLs', () => {
  assert.throws(() => loadConfig({ MIS_BASE_URL: 'http://evil.example.com' }), /https/);
});

test('mis_collect_account_data collects account scope via GET-only and mis_get_user_logs filters live & snapshot logs', async t => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mis-collect-'));
  const exportsDir = path.join(tmpRoot, 'exports');
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  const mock = await withMockServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.setHeader('Content-Type', 'application/json');
    const urlPath = req.url.split('?')[0];
    if (urlPath === '/api/v1/auth/me') {
      return res.end(JSON.stringify({ success: true, user: { id: 'u1', email: 'tai@example.com', full_name: 'Nguyen Xuan Tai', role: 'instructor' } }));
    }
    if (urlPath === '/api/v1/auth/tlu/status') {
      return res.end(JSON.stringify({ success: true, data: { status: 'NOT_LINKED' } }));
    }
    if (urlPath === '/api/v1/projects/') {
      return res.end(JSON.stringify([{ id: 'p1', name: 'Project One' }]));
    }
    if (urlPath === '/api/v1/projects/p1') {
      return res.end(JSON.stringify({ id: 'p1', name: 'Project One', status: 'ACTIVE' }));
    }
    if (urlPath === '/api/v1/projects/p1/members') {
      return res.end(JSON.stringify([
        { user_id: 'u1', role: 'LEADER', user: { id: 'u1', email: 'tai@example.com', full_name: 'Nguyen Xuan Tai' } },
        { user_id: 'u2', role: 'MEMBER', user: { id: 'u2', email: 'other@example.com', full_name: 'Other User' } }
      ]));
    }
    if (urlPath === '/api/v1/projects/p1/tasks/') {
      return res.end(JSON.stringify([{
        id: 't1',
        title: 'Task Alpha',
        assignees: [{ id: 'u1', email: 'tai@example.com', full_name: 'Nguyen Xuan Tai' }],
        checklists: [
          { id: 'chk1', task_id: 't1', title: 'Item 1', is_completed: true, completed_by_id: 'u1', actual_hours: 1.5 }
        ],
        comments: [
          { id: 'c1', task_id: 't1', user_id: 'u1', content: 'Manual comment by u1', is_system_log: false, created_at: '2026-11-10T10:00:00Z' },
          { id: 'c2', task_id: 't1', user_id: 'u1', content: 'Moved to DONE', is_system_log: true, created_at: '2026-11-11T10:00:00Z' },
          { id: 'c3', task_id: 't1', user_id: 'u2', content: 'Comment by u2', is_system_log: false, created_at: '2026-11-12T10:00:00Z' }
        ],
        reports: [
          { id: 'r1', task_id: 't1', user_id: 'u1', user: { id: 'u1', email: 'tai@example.com', full_name: 'Nguyen Xuan Tai' }, report_text: 'Submitted log', created_at: '2026-11-11T08:00:00Z' }
        ]
      }]));
    }
    if (urlPath === '/api/v1/projects/p1/tasks/claimable') return res.end(JSON.stringify([]));
    if (urlPath === '/api/v1/projects/p1/documents/') return res.end(JSON.stringify([{ id: 'd1', title: 'Spec Doc' }]));
    if (urlPath === '/api/v1/projects/p1/documents/d1') return res.end(JSON.stringify({ id: 'd1', title: 'Spec Doc', content: 'Full body' }));
    if (urlPath === '/api/v1/projects/p1/feed') {
      return res.end(JSON.stringify({
        feed: [
          { id: 'c2', task_id: 't1', task_title: 'Task Alpha', user_name: 'Nguyen Xuan Tai', content: 'Moved to DONE', is_system_log: true, created_at: '2026-11-11T10:00:00Z' },
          { id: 'f_only', task_id: null, user_name: 'Nguyen Xuan Tai', content: 'Project comment on feed', is_system_log: false, created_at: '2026-11-13T10:00:00Z' }
        ]
      }));
    }
    if (urlPath === '/api/v1/projects/analytics/performance') return res.end(JSON.stringify({ summary: { total_projects: 1 } }));
    if (urlPath === '/api/v1/courses') return res.end(JSON.stringify([{ id: 'crs1', course_name: 'Course 1' }]));
    if (urlPath === '/api/v1/courses/crs1/assignments') return res.end(JSON.stringify([{ id: 'a1', title: 'Assignment 1' }]));
    if (urlPath === '/api/v1/assignments/a1') return res.end(JSON.stringify({ id: 'a1', title: 'Assignment 1' }));
    if (urlPath.startsWith('/api/v1/courses/crs1/')) return res.end(JSON.stringify([]));
    if (urlPath.startsWith('/api/v1/analytics/courses/crs1/')) return res.end(JSON.stringify({}));
    if (urlPath.startsWith('/api/v1/assignments/a1/')) return res.end(JSON.stringify({ items: [] }));
    res.statusCode = 404;
    res.end(JSON.stringify({ detail: 'Not found' }));
  });
  t.after(() => mock.close());

  const srv = createMcpServer({
    config: {
      workspaceRoot: tmpRoot,
      baseUrl: mock.baseUrl,
      token: 'tok',
      cdpEndpoint: 'http://127.0.0.1:4444',
      readOnly: true,
      timeoutMs: 5000,
      envFile: '',
      downloadsDir: path.join(tmpRoot, 'downloads'),
      exportsDir
    }
  });

  const collectRes = await srv.dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'mis_collect_account_data', arguments: { output_dir: 'snap1' } }
  });
  assert.equal(collectRes.result.isError, false);
  const manifest = collectRes.result.structuredContent.data;
  assert.equal(manifest.stats.projects, 1);
  assert.equal(manifest.stats.tasks, 1);
  assert.equal(manifest.stats.checklists, 1);
  assert.equal(manifest.stats.comments, 3);
  assert.equal(manifest.stats.manualComments, 2);
  assert.equal(manifest.stats.systemLogs, 1);
  assert.equal(manifest.stats.reports, 1);
  assert.equal(manifest.stats.courses, 1);
  assert.equal(manifest.stats.assignments, 1);
  // c2 is deduplicated between task.comments and project.feed, so u1 has: c1, c2, r1, chk1, f_only = 5
  assert.equal(manifest.stats.accountTimelineEvents, 5);
  assert.ok(fs.existsSync(manifest.files.fullSnapshot));
  assert.ok(fs.existsSync(manifest.files.userTimeline));
  assert.ok(fs.existsSync(path.join(exportsDir, 'latest-manifest.json')));

  const badDir = await srv.dispatch({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'mis_collect_account_data', arguments: { output_dir: '../escape' } }
  });
  assert.equal(badDir.result.isError, true);
  assert.equal(badDir.result.structuredContent.error.code, 'INVALID_PATH');

  // Test offline user logs query from manifest without system logs
  const offlineLogs = await srv.dispatch({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'mis_get_user_logs',
      arguments: {
        snapshot_path: manifest.files.manifest,
        include_system_logs: false,
        save_to_file: true
      }
    }
  });
  assert.equal(offlineLogs.result.isError, false);
  const offData = offlineLogs.result.structuredContent.data;
  assert.equal(offData.sourceMode, 'snapshot');
  assert.equal(offData.totalMatched, 4); // c1, r1, chk1, f_only
  assert.ok(fs.existsSync(offData.savedPath));

  // Test live user logs query filtered to another user by email + type filter
  const liveOtherLogs = await srv.dispatch({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'mis_get_user_logs',
      arguments: {
        email: 'other@example.com',
        types: ['comment']
      }
    }
  });
  assert.equal(liveOtherLogs.result.isError, false);
  const otherData = liveOtherLogs.result.structuredContent.data;
  assert.equal(otherData.sourceMode, 'live');
  assert.equal(otherData.totalMatched, 1);
  assert.equal(otherData.logs[0].content, 'Comment by u2');

  // Test mis_query_my_tasks separates status buckets and date evidence strictly
  const taskQuery = await srv.dispatch({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'mis_query_my_tasks',
      arguments: {
        snapshot_path: manifest.files.manifest,
        date_vn: '2026-11-11'
      }
    }
  });
  assert.equal(taskQuery.result.isError, false);
  const qData = taskQuery.result.structuredContent.data;
  assert.equal(qData.sourceMode, 'snapshot');
  assert.equal(qData.dateAnalysis.date_vn, '2026-11-11');
  assert.equal(qData.dateAnalysis.workedOnDateCount, 1);
  assert.equal(qData.dateAnalysis.worked_on_date[0].task_id, 't1');
  assert.equal(qData.dateAnalysis.worked_on_date[0].evidence_count, 2); // c2 + r1 on 2026-11-11

  const compactTimeline = await srv.dispatch({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'mis_get_user_logs',
      arguments: {
        snapshot_path: manifest.files.manifest,
        project_id: 'p1',
        all_actors: true,
        compact: true
      }
    }
  });
  assert.equal(compactTimeline.result.isError, false);
  assert.ok(compactTimeline.result.structuredContent.data.logs.length <= 25);
});

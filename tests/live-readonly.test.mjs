import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.mjs';
import { createMcpServer } from '../src/mcp-server.mjs';

test('Live read-only verification against mis.oanhcuongdo.com (GET-only, MIS_READ_ONLY enforced)', async () => {
  const baseConfig = loadConfig();
  assert.ok(baseConfig.token, 'MIS_BEARER_TOKEN must be configured in .env.mis');
  // Enforce readOnly: true so zero non-GET calls are physically possible
  const srv = createMcpServer({ config: { ...baseConfig, readOnly: true } });

  const call = async (name, args = {}) => {
    const res = await srv.dispatch({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args } });
    assert.equal(res.result.isError, false, `${name} failed: ${res.result.content[0].text}`);
    return res.result.structuredContent.data;
  };

  const health = await call('mis_health');
  assert.ok(health);

  const me = await call('mis_get_me');
  assert.equal(me.success, true);
  assert.ok(me.user?.id);

  const projects = await call('mis_list_projects');
  assert.ok(Array.isArray(projects) && projects.length > 0);

  const sampleProjectId = projects[0].id;
  const projectDetail = await call('mis_get_project', { project_id: sampleProjectId });
  assert.equal(projectDetail.id, sampleProjectId);

  const feed = await call('mis_get_project_feed', { project_id: sampleProjectId });
  assert.ok(Array.isArray(feed.feed));

  const tasks = await call('mis_list_tasks', { project_id: sampleProjectId });
  assert.ok(Array.isArray(tasks));
  if (tasks.length > 0) {
    const taskDetail = await call('mis_get_task', { project_id: sampleProjectId, task_id: tasks[0].id });
    assert.equal(taskDetail.id, tasks[0].id);
  }

  const docs = await call('mis_list_documents', { project_id: sampleProjectId });
  assert.ok(Array.isArray(docs));

  const courses = await call('mis_list_courses');
  assert.ok(Array.isArray(courses));

  const gallery = await call('mis_list_gallery_videos', { page: 1, page_size: 5 });
  assert.ok(gallery);

  const collected = await call('mis_collect_account_data', {
    include_document_details: false,
    include_gallery: false,
    output_dir: 'live-verify'
  });
  assert.ok(collected.stats.projects >= 1);
  assert.ok(collected.stats.tasks >= 1);

  const userLogs = await call('mis_get_user_logs', {
    snapshot_path: collected.files.manifest,
    limit: 50
  });
  assert.equal(userLogs.sourceMode, 'snapshot');
  assert.ok(userLogs.totalMatched >= 1);

  // Confirm write tool is strictly blocked in read-only test mode
  const blockedWrite = await srv.dispatch({
    jsonrpc: '2.0',
    id: 'blocked-write',
    method: 'tools/call',
    params: { name: 'mis_create_task', arguments: { project_id: sampleProjectId, title: 'Should never run' } }
  });
  assert.equal(blockedWrite.result.isError, true);
  assert.equal(blockedWrite.result.structuredContent.error.code, 'READ_ONLY_MODE');
});

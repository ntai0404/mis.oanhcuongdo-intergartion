import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
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

test('Live MIS questions through MCP stdio (GET-only)', { timeout: 60000 }, async t => {
  const server = spawn(process.execPath, ['src/mcp-server.mjs'], {
    env: { ...process.env, MIS_READ_ONLY: '1' },
    stdio: ['pipe', 'pipe', 'ignore']
  });
  t.after(() => server.kill());
  const replies = createInterface({ input: server.stdout })[Symbol.asyncIterator]();
  let id = 0;
  async function rpc(method, params) {
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const reply = await replies.next();
    assert.equal(reply.done, false, 'MCP process closed before responding');
    const { result, error, id: echoedId } = JSON.parse(reply.value);
    assert.equal(echoedId, id);
    assert.equal(error, undefined);
    if (method === 'tools/call') assert.equal(result.isError, false, result.structuredContent?.error?.code);
    return result.structuredContent?.data ?? result;
  }
  const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
  const hello = await rpc('initialize');
  assert.match(hello.instructions, /Vietnamese MIS questions/);
  assert.equal((await rpc('tools/list')).tools.length, 49);

  const dateAt = timestamp => new Date(timestamp + 7 * 3600000).toISOString().slice(0, 10);
  const today = dateAt(Date.now());
  const calendarToday = new Date(today + 'T00:00:00Z');
  const monday = new Date(calendarToday.getTime() - ((calendarToday.getUTCDay() + 6) % 7) * 86400000)
    .toISOString().slice(0, 10);
  const yesterday = new Date(calendarToday.getTime() - 86400000).toISOString().slice(0, 10);
  const projects = await call('mis_list_projects');
  let project;
  let task;
  for (const candidate of projects) {
    const tasks = await call('mis_list_tasks', { project_id: candidate.id });
    task = tasks.find(item => item.comments?.some(comment =>
      comment.is_system_log && /chuyển trạng thái sang\s*['"](?:INTERNAL_REVIEW|MENTOR_REVIEW)['"]/iu.test(comment.content)));
    if (task) { project = candidate; break; }
  }
  assert.ok(project && task, 'No visible task with a review transition');
  const scoped = { project_id: project.id };
  const selected = { ...scoped, task_id: task.id };
  const examples = [];
  function record(question, status, evidence) {
    examples.push({ question, status, evidence });
  }

  const checkin = await call('mis_query_my_tasks', { date_vn: today, limit: 5 });
  assert.equal(checkin.coverage, 'visible_sources');
  assert.equal(checkin.summary.totalAssigned, Object.values(checkin.summary.byStatus).reduce((a, b) => a + b, 0));
  assert.ok(Object.values(checkin.buckets).every(bucket => bucket.length <= 5));
  record('Hôm nay tôi có task nào cần làm?', 'PASS', {
    date: today, projects: checkin.scannedProjectsCount, actionable: checkin.summary.actionableCount,
    review: checkin.summary.inReviewCount, due: checkin.dateAnalysis.deadlineOnDateCount
  });

  const history = await call('mis_query_my_tasks', { date_vn: yesterday, limit: 5 });
  assert.equal(history.coverage, 'visible_sources');
  assert.ok(history.dateAnalysis.completed_on_date.every(row => row.done_transitions.every(event => event.to_status === 'DONE')));
  record('Hôm qua tôi đã làm và hoàn thành những task nào?', 'PARTIAL', {
    date: yesterday, visibleActivityTasks: history.dateAnalysis.workedOnDateCount,
    loggedDoneInCurrentAssignmentCohort: history.dateAnalysis.completedOnDateCount
  });

  const week = await call('mis_query_my_tasks', { date_from: monday, date_to: today, limit: 5 });
  assert.equal(week.coverage, 'visible_sources');
  assert.equal(week.periodAnalysis.date_from, monday);
  record('Tiến độ của tôi từ đầu tuần tới hôm nay thế nào?', 'PARTIAL', {
    from: monday, to: today, visibleActivityTasks: week.periodAnalysis.workedOnDateCount,
    loggedDoneInCurrentAssignmentCohort: week.periodAnalysis.completedOnDateCount,
    reviewTasks: week.periodAnalysis.reviewOnDateCount
  });

  const activityArgs = { ...scoped, all_actors: true, compact: true, limit: 3 };
  const activity = await call('mis_get_user_logs', activityArgs);
  assert.equal(activity.warnings, undefined);
  assert.ok(activity.logs.length > 0 && activity.logs.length <= 3);
  assert.ok(activity.logs.every(row => row.project_id === project.id && !Object.hasOwn(row, 'ip_address')));
  if (activity.next_offset !== null) {
    const more = await call('mis_get_user_logs', { ...activityArgs, offset: activity.next_offset });
    assert.equal(more.totalMatched, activity.totalMatched);
    assert.ok(more.logs.every(row => !activity.logs.some(previous => previous.source === row.source && previous.id === row.id)));
  }
  record('Dự án này có hoạt động gì gần đây?', 'PARTIAL', {
    visibleRows: activity.totalMatched, returned: activity.returnedCount, nextOffset: activity.next_offset,
    limitation: 'project feed may have display name only'
  });

  const detail = await call('mis_get_task', selected);
  assert.equal(detail.id, task.id);
  for (const key of ['status', 'parent_id', 'assignee_id', 'deadline', 'checklists', 'reports', 'comments']) {
    assert.deepEqual(detail[key], task[key], key);
  }
  record('Cho tôi chi tiết task này, gồm checklist, comment và báo cáo', 'PASS', {
    checklistCount: detail.checklists.length, reportCount: detail.reports.length, commentCount: detail.comments.length
  });
  const search = await call('mis_list_tasks', { ...scoped, compact: true, search: task.title, limit: 100 });
  assert.ok(search.items.some(item => item.id === task.id));
  assert.ok(search.items.every(item => !Object.hasOwn(item, 'reports')));

  const review = await call('mis_get_task', { ...selected, view: 'history', limit: 100 });
  assert.ok(review.transitions.items.some(event => ['INTERNAL_REVIEW', 'MENTOR_REVIEW'].includes(event.to_status)));
  const sourceIds = new Set(detail.comments.filter(comment => comment.is_system_log).map(comment => comment.id));
  assert.ok(review.transitions.items.every(event => sourceIds.has(event.source_id)));
  assert.ok(review.assignment_events.items.every(event => sourceIds.has(event.source_id)));
  assert.ok(review.checklist_events.items.every(event => sourceIds.has(event.source_id)));
  const milestones = await call('mis_get_project_performance', selected);
  assert.ok(Array.isArray(milestones.milestones));
  record('Ai đưa task này vào review và khi nào?', 'PARTIAL', {
    transitions: review.transitions.total,
    destinations: [...new Set(review.transitions.items.map(event => event.to_status))],
    actorIdCount: review.transitions.items.filter(event => event.actor_user_id).length,
    assignmentEvents: review.assignment_events.total, checklistEvents: review.checklist_events.total,
    performanceRows: milestones.milestones.length
  });
  const pending = await call('mis_list_gallery_videos', { pending: true, page: 1, page_size: 1 });
  assert.ok(Array.isArray(pending.items) && pending.items.length <= 1);
  const documents = await call('mis_list_gallery_documents', { page: 1 });
  if (documents.items?.length) {
    const documentId = documents.items[0].id;
    const document = await call('mis_get_document', { scope: 'course', document_id: documentId });
    assert.equal(document.id, documentId);
  }

  const evidence = { observedAt: new Date().toISOString(), transport: 'MCP stdio', cases: examples };
  mkdirSync(new URL('../reports/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../reports/mis-data-access-e2e.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
  t.diagnostic(JSON.stringify(evidence));
});

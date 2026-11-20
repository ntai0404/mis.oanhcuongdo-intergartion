import fs from 'node:fs';
import path from 'node:path';
import { MisApiError, assertSafeSegment } from './client.mjs';
import { dateBounds, loggedActorName, pageOf, statusTransition, toVnTimestamp } from './data-access.mjs';

const VALID_LOG_TYPES = ['comment', 'system_log', 'report', 'checklist', 'feed'];

export function getExportsRoot(config = {}) {
  if (config.exportsDir) return path.resolve(config.exportsDir);
  if (config.workspaceRoot) return path.resolve(config.workspaceRoot, 'exports');
  if (config.downloadsDir) return path.resolve(path.dirname(config.downloadsDir), 'exports');
  return path.resolve('exports');
}

export function resolveConfinedPath(inputPath, allowedRoot, label = 'path') {
  const root = path.resolve(allowedRoot);
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(root, inputPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new MisApiError('INVALID_PATH', `${label} must stay inside ${root}`, 400);
  }
  return resolved;
}

async function mapLimit(items, concurrency, worker) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const count = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: count }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }));
  return results;
}

async function safeGet(client, apiPath, options, warnings, scope) {
  try {
    return await client.request('GET', apiPath, options);
  } catch (err) {
    warnings.push({
      scope,
      path: apiPath,
      code: err instanceof MisApiError ? err.code : 'ERROR',
      status: err instanceof MisApiError ? err.status : 500,
      message: err.message
    });
    return null;
  }
}

function slugToken(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64) || 'unknown';
}

function registerUser(userMap, user) {
  if (!user || typeof user !== 'object' || !user.id) return;
  const existing = userMap.get(user.id) || {};
  userMap.set(user.id, {
    id: user.id,
    email: user.email || existing.email || null,
    full_name: user.full_name || existing.full_name || null
  });
}

function enrichTargetUserFromBundles(projectBundles, targetUser) {
  if (!targetUser) return targetUser;
  const userMap = new Map();
  for (const b of projectBundles) {
    for (const m of b.members || []) registerUser(userMap, m.user || m);
    for (const t of b.tasks || []) {
      for (const a of t.assignees || []) registerUser(userMap, a);
      for (const r of t.reports || []) registerUser(userMap, r.user);
    }
  }
  for (const u of userMap.values()) {
    const idMatch = targetUser.id && u.id === targetUser.id;
    const emailMatch = !targetUser.id && targetUser.email && u.email?.toLowerCase() === targetUser.email.toLowerCase();
    if (idMatch || emailMatch) {
      return {
        ...targetUser,
        id: u.id || targetUser.id,
        email: u.email || targetUser.email,
        full_name: u.full_name || targetUser.full_name
      };
    }
  }
  return targetUser;
}

function matchesTargetUser(target, candidateId, candidateEmail) {
  if (!target || (!target.id && !target.email && !target.full_name)) return true;
  if (target.id && candidateId) return candidateId === target.id;
  if (target.email && candidateEmail && candidateEmail.toLowerCase() === target.email.toLowerCase()) return true;
  return false;
}

/**
 * Normalize and filter activity logs (comments, system logs, reports, completed checklists, and feed events)
 * across one or more project bundles for a target user.
 */
export function buildUserTimeline(projectBundles, targetUser = null, options = {}) {
  const includeSystemLogs = options.include_system_logs !== false;
  const includeFeedOnlyEvents = options.include_feed_only_events !== false;
  const allowedTypes = Array.isArray(options.types) && options.types.length > 0
    ? new Set(options.types)
    : new Set(VALID_LOG_TYPES);

  for (const t of allowedTypes) {
    if (!VALID_LOG_TYPES.includes(t)) {
      throw new MisApiError('INVALID_ARGUMENT', `types entries must be one of: ${VALID_LOG_TYPES.join(', ')}`, 400);
    }
  }

  const within = dateBounds(options.date_from, options.date_to);
  const dated = Boolean(options.date_from || options.date_to);
  const limit = Number.isInteger(options.limit) ? options.limit : (options.compact ? 25 : 500);

  const userMap = new Map();
  if (targetUser) registerUser(userMap, targetUser);

  for (const bundle of projectBundles) {
    for (const m of bundle.members || []) registerUser(userMap, m.user || m);
    for (const t of bundle.tasks || []) {
      for (const a of t.assignees || []) registerUser(userMap, a);
      for (const r of t.reports || []) registerUser(userMap, r.user);
    }
  }

  const matched = [];
  const breakdown = { comment: 0, system_log: 0, report: 0, checklist: 0, feed: 0 };

  const pushIfMatched = entry => {
    if (!allowedTypes.has(entry.type)) return;
    if (!includeSystemLogs && entry.type === 'system_log') return;
    if (dated && !within(entry.created_at)) return;
    breakdown[entry.type] = (breakdown[entry.type] || 0) + 1;
    matched.push(entry);
  };

  for (const bundle of projectBundles) {
    const project = bundle.project || {};
    const projectId = project.id || bundle.project_id || null;
    const projectName = project.name || null;
    const seenIds = new Set();

    for (const task of bundle.tasks || []) {
      for (const c of task.comments || []) {
        if (c.id) seenIds.add(c.id);
        const u = userMap.get(c.user_id);
        if (!matchesTargetUser(targetUser, c.user_id, u?.email)) continue;
        pushIfMatched({
          id: c.id || null,
          source: 'task_comment',
          type: c.is_system_log ? 'system_log' : 'comment',
          is_system_log: Boolean(c.is_system_log),
          created_at: c.created_at || null,
          project_id: projectId,
          project_name: projectName,
          task_id: task.id || null,
          task_title: task.title || null,
          user_id: c.user_id || null,
          user_name: u?.full_name || loggedActorName(c) || null,
          user_email: u?.email || null,
          content: c.content || '',
          ip_address: c.ip_address || null,
          location: c.location || null
        });
      }

      for (const r of task.reports || []) {
        const u = r.user || userMap.get(r.user_id);
        if (!matchesTargetUser(targetUser, r.user_id || u?.id, u?.email)) continue;
        pushIfMatched({
          id: r.id || null,
          source: 'task_report',
          type: 'report',
          is_system_log: false,
          created_at: r.created_at || null,
          project_id: projectId,
          project_name: projectName,
          task_id: task.id || null,
          task_title: task.title || null,
          user_id: r.user_id || u?.id || null,
          user_name: u?.full_name || null,
          user_email: u?.email || null,
          content: r.report_text || '',
          report_link_url: r.report_link_url || null,
          file_url: r.file_url || null,
          file_name: r.file_name || null,
          file_size_bytes: r.file_size_bytes ?? null,
          ip_address: r.ip_address || null,
          location: r.location || null
        });
      }

      for (const ch of task.checklists || []) {
        if (!ch.is_completed && !ch.completed_by_id) continue;
        const u = userMap.get(ch.completed_by_id);
        if (!matchesTargetUser(targetUser, ch.completed_by_id, u?.email)) continue;
        pushIfMatched({
          id: ch.id || null,
          source: 'task_checklist',
          type: 'checklist',
          is_system_log: false,
          created_at: ch.completed_at || null,
          evidence: ch.completed_at ? 'checklist_completion_timestamp' : 'current_checklist_state',
          project_id: projectId,
          project_name: projectName,
          task_id: task.id || null,
          task_title: task.title || null,
          user_id: ch.completed_by_id || null,
          user_name: u?.full_name || null,
          user_email: u?.email || null,
          content: ch.title || '',
          is_completed: Boolean(ch.is_completed),
          estimated_hours: ch.estimated_hours ?? null,
          actual_hours: ch.actual_hours ?? null
        });
      }
    }

    if (includeFeedOnlyEvents) {
      const feedItems = Array.isArray(bundle.feed?.feed)
        ? bundle.feed.feed
        : (Array.isArray(bundle.feed) ? bundle.feed : []);
      for (const f of feedItems) {
        if (f.id && seenIds.has(f.id)) continue;
        const nameMatch = !options.compact && !dated && !f.user_id && targetUser?.full_name
          && f.user_name === targetUser.full_name;
        if (!nameMatch && !matchesTargetUser(targetUser, f.user_id || null, null)) continue;
        const isSys = Boolean(f.is_system_log);
        if (!includeSystemLogs && isSys) continue;
        pushIfMatched({
          id: f.id || null,
          source: 'project_feed',
          actor_attribution: f.user_id ? 'user_id' : nameMatch ? 'inferred_display_name' : 'display_name_only',
          type: isSys ? 'feed' : 'comment',
          is_system_log: isSys,
          created_at: f.created_at || null,
          project_id: projectId,
          project_name: projectName,
          task_id: f.task_id || null,
          task_title: f.task_title || null,
          user_id: f.user_id || null,
          user_name: f.user_name || null,
          user_email: null,
          content: f.content || ''
        });
      }
    }
  }

  matched.sort((a, b) => {
    const ams = a.created_at ? Date.parse(a.created_at) : -1;
    const bms = b.created_at ? Date.parse(b.created_at) : -1;
    return (Number.isNaN(bms) ? -1 : bms) - (Number.isNaN(ams) ? -1 : ams);
  });

  const offset = options.offset ?? 0;
  const page = pageOf(matched, offset, limit > 0 ? limit : matched.length);
  const limited = options.compact
    ? page.items.map(({ ip_address, location, user_email, file_url, ...entry }) => ({
        ...entry, timestamp_vn: toVnTimestamp(entry.created_at), content: String(entry.content || '').slice(0, 240)
      }))
    : page.items;
  return {
    totalMatched: matched.length,
    returnedCount: limited.length,
    truncated: offset > 0 || page.next_offset !== null,
    offset,
    next_offset: page.next_offset,
    breakdown,
    logs: limited
  };
}

async function collectProjectBundle(client, config, projectSummary, opts, warnings) {
  const pid = assertSafeSegment(projectSummary.id, 'project_id');
  const [project, members, rawTasks, claimableTasks, documents, feed, performance, aiSummary] = await Promise.all([
    safeGet(client, `/api/v1/projects/${pid}`, {}, warnings, `project:${projectSummary.id}:detail`),
    safeGet(client, `/api/v1/projects/${pid}/members`, {}, warnings, `project:${projectSummary.id}:members`),
    safeGet(client, `/api/v1/projects/${pid}/tasks/`, {}, warnings, `project:${projectSummary.id}:tasks`),
    safeGet(client, `/api/v1/projects/${pid}/tasks/claimable`, {}, warnings, `project:${projectSummary.id}:claimable`),
    safeGet(client, `/api/v1/projects/${pid}/documents/`, {}, warnings, `project:${projectSummary.id}:documents`),
    safeGet(client, `/api/v1/projects/${pid}/feed`, {}, warnings, `project:${projectSummary.id}:feed`),
    safeGet(client, '/api/v1/projects/analytics/performance', { query: { project_id: projectSummary.id } }, warnings, `project:${projectSummary.id}:performance`),
    opts.include_ai_summary
      ? safeGet(client, `/api/v1/projects/${pid}/ai-summary`, { timeoutMs: 45000 }, warnings, `project:${projectSummary.id}:ai-summary`)
      : Promise.resolve(null)
  ]);

  let tasks = Array.isArray(rawTasks) ? rawTasks : [];
  if (opts.include_task_details && tasks.length > 0) {
    const detailed = await mapLimit(tasks, 4, async task => {
      const tid = assertSafeSegment(task.id, 'task_id');
      const full = await safeGet(client, `/api/v1/projects/${pid}/tasks/${tid}`, {}, warnings, `task:${task.id}`);
      return full || task;
    });
    tasks = detailed;
  }

  let docs = Array.isArray(documents) ? documents : [];
  if (opts.include_document_details && docs.length > 0) {
    docs = await mapLimit(docs, 4, async doc => {
      const did = assertSafeSegment(doc.id, 'document_id');
      const detail = await safeGet(client, `/api/v1/projects/${pid}/documents/${did}`, {}, warnings, `document:${doc.id}`);
      return detail || doc;
    });
  }

  const downloadedFiles = [];
  if (opts.download_report_files) {
    const targets = [];
    for (const task of tasks) {
      for (const r of task.reports || []) {
        if (r.file_url && r.id) targets.push({ taskId: task.id, reportId: r.id, fileName: r.file_name || null });
      }
    }
    const dlDir = path.join(config.downloadsDir || getExportsRoot(config), 'reports', slugToken(projectSummary.id));
    await mapLimit(targets, 2, async item => {
      const tid = assertSafeSegment(item.taskId, 'task_id');
      const rid = assertSafeSegment(item.reportId, 'report_id');
      const res = await safeGet(
        client,
        `/api/v1/projects/${pid}/tasks/${tid}/reports/${rid}/download`,
        { saveToDir: dlDir, fallbackFilename: item.fileName || undefined, timeoutMs: 60000 },
        warnings,
        `download:report:${item.reportId}`
      );
      if (res) downloadedFiles.push({ kind: 'task_report', project_id: projectSummary.id, task_id: item.taskId, report_id: item.reportId, ...res });
    });
  }

  if (opts.download_document_files && docs.length > 0) {
    const dlDir = path.join(config.downloadsDir || getExportsRoot(config), 'documents', slugToken(projectSummary.id));
    await mapLimit(docs.filter(d => d.file_url || d.file_name), 2, async doc => {
      const did = assertSafeSegment(doc.id, 'document_id');
      const res = await safeGet(
        client,
        `/api/v1/project-documents/${did}/file`,
        { saveToDir: dlDir, fallbackFilename: doc.file_name || undefined, timeoutMs: 60000 },
        warnings,
        `download:document:${doc.id}`
      );
      if (res) downloadedFiles.push({ kind: 'project_document', project_id: projectSummary.id, document_id: doc.id, ...res });
    });
  }

  return {
    project: project || projectSummary,
    members: Array.isArray(members) ? members : [],
    tasks,
    claimableTasks: Array.isArray(claimableTasks) ? claimableTasks : [],
    documents: docs,
    feed: feed || { feed: [] },
    performance,
    ...(aiSummary ? { aiSummary } : {}),
    ...(downloadedFiles.length > 0 ? { downloadedFiles } : {})
  };
}

async function collectCourseBundle(client, courseSummary, warnings) {
  const cid = assertSafeSegment(courseSummary.id, 'course_id');
  const [
    students,
    documents,
    groups,
    groupProfile,
    assignments,
    taskSummary,
    analyticsOverview,
    leaderboard,
    roster,
    inactiveEnrollments
  ] = await Promise.all([
    safeGet(client, `/api/v1/courses/${cid}/students`, {}, warnings, `course:${courseSummary.id}:students`),
    safeGet(client, `/api/v1/courses/${cid}/documents`, {}, warnings, `course:${courseSummary.id}:documents`),
    safeGet(client, `/api/v1/courses/${cid}/groups`, {}, warnings, `course:${courseSummary.id}:groups`),
    safeGet(client, `/api/v1/courses/${cid}/group-profile`, {}, warnings, `course:${courseSummary.id}:group-profile`),
    safeGet(client, `/api/v1/courses/${cid}/assignments`, {}, warnings, `course:${courseSummary.id}:assignments`),
    safeGet(client, `/api/v1/courses/${cid}/task-summary`, {}, warnings, `course:${courseSummary.id}:task-summary`),
    safeGet(client, `/api/v1/analytics/courses/${cid}/overview`, {}, warnings, `course:${courseSummary.id}:analytics-overview`),
    safeGet(client, `/api/v1/analytics/courses/${cid}/leaderboard`, {}, warnings, `course:${courseSummary.id}:leaderboard`),
    safeGet(client, `/api/v1/courses/${cid}/roster`, {}, warnings, `course:${courseSummary.id}:roster`),
    safeGet(client, `/api/v1/courses/${cid}/inactive-enrollments`, {}, warnings, `course:${courseSummary.id}:inactive-enrollments`)
  ]);

  const assignmentList = Array.isArray(assignments) ? assignments : [];
  const enrichedAssignments = await mapLimit(assignmentList, 3, async a => {
    const aid = assertSafeSegment(a.id, 'assignment_id');
    const [detail, submissions, quickReport] = await Promise.all([
      safeGet(client, `/api/v1/assignments/${aid}`, {}, warnings, `assignment:${a.id}:detail`),
      safeGet(client, `/api/v1/assignments/${aid}/submissions`, { query: { page: 1, page_size: 100 } }, warnings, `assignment:${a.id}:submissions`),
      safeGet(client, `/api/v1/assignments/${aid}/quick-report`, {}, warnings, `assignment:${a.id}:quick-report`)
    ]);
    return {
      ...(detail || a),
      submissions,
      quickReport
    };
  });

  return {
    course: courseSummary,
    students,
    documents,
    groups,
    groupProfile,
    assignments: enrichedAssignments,
    taskSummary,
    analyticsOverview,
    leaderboard,
    roster,
    inactiveEnrollments
  };
}

/**
 * Collect all accessible Matrix AI EDU account data (GET-only) and save structured JSON snapshots locally.
 */
export async function collectAccountData(client, config, args = {}) {
  const opts = {
    include_courses: args.include_courses !== false,
    include_task_details: Boolean(args.include_task_details),
    include_document_details: args.include_document_details !== false,
    include_ai_summary: Boolean(args.include_ai_summary),
    include_gallery: Boolean(args.include_gallery),
    max_gallery_pages: Number.isInteger(args.max_gallery_pages) ? args.max_gallery_pages : 2,
    download_report_files: Boolean(args.download_report_files),
    download_document_files: Boolean(args.download_document_files),
    include_inline_summary_only: args.include_inline_summary_only !== false
  };

  const exportsRoot = getExportsRoot(config);
  const warnings = [];

  const meRes = await client.request('GET', '/api/v1/auth/me');
  const user = meRes?.user || meRes || {};
  const [tluStatus, rawProjects, performanceOverall] = await Promise.all([
    safeGet(client, '/api/v1/auth/tlu/status', {}, warnings, 'auth:tlu-status'),
    client.request('GET', '/api/v1/projects/'),
    safeGet(client, '/api/v1/projects/analytics/performance', {}, warnings, 'projects:analytics-performance')
  ]);

  let projectList = Array.isArray(rawProjects) ? rawProjects : [];
  if (Array.isArray(args.project_ids) && args.project_ids.length > 0) {
    const wanted = new Set(args.project_ids);
    projectList = projectList.filter(p => wanted.has(p.id));
  }

  const projectBundles = await mapLimit(projectList, 3, p => collectProjectBundle(client, config, p, opts, warnings));

  let courseBundles = [];
  if (opts.include_courses) {
    const rawCourses = await safeGet(client, '/api/v1/courses', {}, warnings, 'courses:list');
    const courseList = Array.isArray(rawCourses) ? rawCourses : [];
    courseBundles = await mapLimit(courseList, 2, c => collectCourseBundle(client, c, warnings));
  }

  let gallery = null;
  if (opts.include_gallery) {
    const videoPages = [];
    for (let page = 1; page <= opts.max_gallery_pages; page++) {
      const res = await safeGet(client, '/api/v1/gallery/videos', { query: { page, page_size: 50 } }, warnings, `gallery:videos:p${page}`);
      if (!res) break;
      videoPages.push(res);
      const items = res.items || [];
      if (items.length === 0 || (res.total !== undefined && page * 50 >= res.total)) break;
    }
    const docPages = [];
    for (let page = 1; page <= opts.max_gallery_pages; page++) {
      const res = await safeGet(client, '/api/v1/gallery/documents', { query: { page } }, warnings, `gallery:documents:p${page}`);
      if (!res) break;
      docPages.push(res);
      const items = Array.isArray(res) ? res : (res.items || []);
      if (items.length === 0) break;
    }
    gallery = { videoPages, docPages };
  }

  const accountTimeline = buildUserTimeline(projectBundles, {
    id: user.id || null,
    email: user.email || null,
    full_name: user.full_name || null
  }, {
    include_system_logs: true,
    include_feed_only_events: true,
    limit: 5000
  });

  const stats = {
    projects: projectBundles.length,
    members: projectBundles.reduce((acc, b) => acc + (b.members?.length || 0), 0),
    tasks: 0,
    checklists: 0,
    comments: 0,
    manualComments: 0,
    systemLogs: 0,
    reports: 0,
    feedEvents: 0,
    projectDocuments: 0,
    downloadedFiles: 0,
    courses: courseBundles.length,
    assignments: courseBundles.reduce((acc, c) => acc + (c.assignments?.length || 0), 0),
    accountTimelineEvents: accountTimeline.totalMatched,
    warningsCount: warnings.length
  };

  for (const b of projectBundles) {
    stats.projectDocuments += b.documents?.length || 0;
    stats.downloadedFiles += b.downloadedFiles?.length || 0;
    stats.feedEvents += Array.isArray(b.feed?.feed) ? b.feed.feed.length : 0;
    for (const t of b.tasks || []) {
      stats.tasks += 1;
      stats.checklists += t.checklists?.length || 0;
      stats.reports += t.reports?.length || 0;
      for (const c of t.comments || []) {
        stats.comments += 1;
        if (c.is_system_log) stats.systemLogs += 1;
        else stats.manualComments += 1;
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultOutDir = path.join(exportsRoot, `acc-${slugToken(user.id || user.email || 'me')}-${stamp}`);
  const outDir = args.output_dir
    ? resolveConfinedPath(args.output_dir, exportsRoot, 'output_dir')
    : defaultOutDir;

  fs.mkdirSync(path.join(outDir, 'projects'), { recursive: true });
  if (courseBundles.length > 0) fs.mkdirSync(path.join(outDir, 'courses'), { recursive: true });

  const accountPayload = { me: user, tluStatus, performanceOverall };
  const accountFile = path.join(outDir, 'account.json');
  fs.writeFileSync(accountFile, JSON.stringify(accountPayload, null, 2), 'utf8');

  const projectFiles = {};
  for (const bundle of projectBundles) {
    const pidSlug = slugToken(bundle.project?.id || 'unknown');
    const filePath = path.join(outDir, 'projects', `${pidSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    projectFiles[bundle.project?.id || pidSlug] = filePath;
  }

  const courseFiles = {};
  for (const bundle of courseBundles) {
    const cidSlug = slugToken(bundle.course?.id || 'unknown');
    const filePath = path.join(outDir, 'courses', `${cidSlug}.json`);
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    courseFiles[bundle.course?.id || cidSlug] = filePath;
  }

  let galleryFile = null;
  if (gallery) {
    galleryFile = path.join(outDir, 'gallery.json');
    fs.writeFileSync(galleryFile, JSON.stringify(gallery, null, 2), 'utf8');
  }

  const timelineFile = path.join(outDir, 'user-timeline.json');
  fs.writeFileSync(timelineFile, JSON.stringify({ user, ...accountTimeline }, null, 2), 'utf8');

  const fullSnapshot = {
    collectedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    account: accountPayload,
    projects: projectBundles,
    courses: courseBundles,
    ...(gallery ? { gallery } : {}),
    warnings
  };
  const snapshotFile = path.join(outDir, 'full-snapshot.json');
  fs.writeFileSync(snapshotFile, JSON.stringify(fullSnapshot, null, 2), 'utf8');

  const manifest = {
    collectedAt: fullSnapshot.collectedAt,
    baseUrl: config.baseUrl,
    account: {
      id: user.id || null,
      email: user.email || null,
      full_name: user.full_name || null,
      role: user.role || null
    },
    options: opts,
    stats,
    warnings,
    outputDir: outDir,
    files: {
      manifest: path.join(outDir, 'manifest.json'),
      account: accountFile,
      userTimeline: timelineFile,
      fullSnapshot: snapshotFile,
      ...(galleryFile ? { gallery: galleryFile } : {}),
      projects: projectFiles,
      courses: courseFiles
    }
  };

  fs.writeFileSync(manifest.files.manifest, JSON.stringify(manifest, null, 2), 'utf8');
  fs.writeFileSync(path.join(exportsRoot, 'latest-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  if (!opts.include_inline_summary_only) {
    return { ...manifest, data: fullSnapshot };
  }
  return manifest;
}

/**
 * Query full activity & chat logs for a specific user (defaults to current user)
 * from either a saved snapshot file or live GET API calls.
 */
export async function queryUserLogs(client, config, args = {}) {
  dateBounds(args.date_from, args.date_to);
  if (args.all_actors && (args.user_id || args.email || !args.project_id)) {
    throw new MisApiError('INVALID_ARGUMENT', 'all_actors requires a project_id and no user_id or email', 400);
  }
  const workspaceRoot = config.workspaceRoot ? path.resolve(config.workspaceRoot) : path.dirname(getExportsRoot(config));
  const exportsRoot = getExportsRoot(config);

  let snapshot = null;
  if (args.snapshot_path) {
    const resolved = resolveConfinedPath(args.snapshot_path, workspaceRoot, 'snapshot_path');
    if (!fs.existsSync(resolved)) {
      throw new MisApiError('FILE_NOT_FOUND', `Snapshot file not found: ${resolved}`, 404);
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (parsed.files?.fullSnapshot) {
      const nested = resolveConfinedPath(parsed.files.fullSnapshot, workspaceRoot, 'snapshot_path');
      snapshot = JSON.parse(fs.readFileSync(nested, 'utf8'));
    } else {
      snapshot = parsed;
    }
  }

  let targetUser = null;
  if (args.all_actors) {
    targetUser = null;
  } else if (args.user_id || args.email) {
    targetUser = {
      id: args.user_id || null,
      email: args.email || null,
      full_name: null
    };
    if (!targetUser.id && args.email && !snapshot) {
      try {
        const lookedUp = await client.request('GET', '/api/v1/users/lookup', { query: { email: args.email } });
        if (lookedUp && lookedUp.id) {
          targetUser = { id: lookedUp.id, email: lookedUp.email || args.email, full_name: lookedUp.full_name || null };
        }
      } catch {
        // fallback to matching by email/member lookup in scanned projects
      }
    }
  } else if (snapshot?.account?.me) {
    const u = snapshot.account.me;
    targetUser = { id: u.id || null, email: u.email || null, full_name: u.full_name || null };
  } else {
    const meRes = await client.request('GET', '/api/v1/auth/me');
    const u = meRes?.user || meRes || {};
    targetUser = { id: u.id || null, email: u.email || null, full_name: u.full_name || null };
  }

  let projectBundles;
  const warnings = [];
  if (snapshot) {
    projectBundles = Array.isArray(snapshot.projects) ? snapshot.projects : [];
    if (args.project_id) {
      projectBundles = projectBundles.filter(b => b.project?.id === args.project_id);
    }
  } else {
    const projects = args.project_id ? [{ id: args.project_id }] : await client.request('GET', '/api/v1/projects/');
    const needsFeed = args.include_feed_only_events !== false
      && (!args.types?.length || args.types.some(type => type === 'comment' || type === 'feed'));
    projectBundles = await mapLimit(projects, 3, async summary => {
      const projectId = summary.id;
      const pid = assertSafeSegment(projectId, 'project_id');
      const [project, members, tasks, feed] = await Promise.all([
        summary.name ? summary : safeGet(client, `/api/v1/projects/${pid}`, {}, warnings, `project:${projectId}:detail`),
        targetUser?.email && !targetUser.id
          ? safeGet(client, `/api/v1/projects/${pid}/members`, {}, warnings, `project:${projectId}:members`)
          : [],
        safeGet(client, `/api/v1/projects/${pid}/tasks/`, {}, warnings, `project:${projectId}:tasks`),
        needsFeed
          ? safeGet(client, `/api/v1/projects/${pid}/feed`, {}, warnings, `project:${projectId}:feed`)
          : Promise.resolve(null)
      ]);
      return {
        project_id: projectId,
        project: project || { id: projectId },
        members: Array.isArray(members) ? members : [],
        tasks: Array.isArray(tasks) ? tasks : [],
        feed: feed || { feed: [] }
      };
    });
  }

  targetUser = enrichTargetUserFromBundles(projectBundles, targetUser);
  if (!args.all_actors && !targetUser?.id && !targetUser?.email) {
    throw new MisApiError('IDENTITY_UNAVAILABLE', 'No MIS user ID or email was resolved', 422);
  }
  const timeline = buildUserTimeline(projectBundles, targetUser, args);
  let savedPath = null;
  if (args.save_to_file) {
    fs.mkdirSync(exportsRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedPath = path.join(exportsRoot, `user-logs-${slugToken(targetUser?.id || targetUser?.email || 'project')}-${stamp}.json`);
    fs.writeFileSync(savedPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      targetUser,
      scannedProjects: projectBundles.map(b => ({ id: b.project?.id || b.project_id, name: b.project?.name || null })),
      ...timeline
    }, null, 2), 'utf8');
  }

  return {
    sourceMode: snapshot ? 'snapshot' : 'live',
    targetUser,
    coverage: 'Visible task events and project feed. Dated or compact user queries require actor identity. Legacy unfiltered feed name matches are marked inferred. Undated checklist state is excluded from date filters.',
    scannedProjectsCount: projectBundles.length,
    scannedProjects: projectBundles.map(b => ({ id: b.project?.id || b.project_id, name: b.project?.name || null })),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(savedPath ? { savedPath } : {}),
    ...timeline
  };
}

function isUserAssignedToTask(task, targetUser) {
  if (!targetUser) return false;
  if (targetUser.id && task.assignee_id === targetUser.id) return true;
  for (const a of task.assignees || []) {
    if (matchesTargetUser(targetUser, a.id, a.email)) return true;
  }
  return false;
}

function summarizeTask(project, task, nowMs) {
  const checklists = Array.isArray(task.checklists) ? task.checklists : [];
  const doneChk = checklists.filter(c => c.is_completed).length;
  const deadlineMs = task.deadline ? Date.parse(task.deadline) : NaN;
  const isOverdue = task.status !== 'DONE' && !Number.isNaN(deadlineMs) && deadlineMs < nowMs;
  return {
    project_id: project.id || null,
    project_name: project.name || null,
    task_id: task.id || null,
    parent_id: task.parent_id || null,
    title: task.title || '',
    status: task.status || null,
    deadline_utc: task.deadline || null,
    deadline_vn: toVnTimestamp(task.deadline),
    is_overdue: isOverdue,
    is_claimable: Boolean(task.is_claimable),
    checklist_progress: `${doneChk}/${checklists.length}`,
    reports_count: (task.reports || []).length,
    comments_count: (task.comments || []).length,
    assignees: (task.assignees || []).map(a => a.full_name || a.email || a.id)
  };
}

function compactPeriodTask(summary) {
  return {
    project_id: summary.project_id,
    project_name: summary.project_name,
    task_id: summary.task_id,
    parent_id: summary.parent_id,
    title: summary.title,
    status: summary.status,
    deadline_vn: summary.deadline_vn,
    ...(summary.is_overdue ? { is_overdue: true } : {}),
    checklist_progress: summary.checklist_progress
  };
}

/**
 * High-signal, read-only task query across accessible projects for natural Q&A:
 * - Check-in / "today's tasks" (strictly separating TODO, IN_PROGRESS, IN_REVIEW, DONE, and claimable open tasks)
 * - Specific date activity/completion lookup (`date_vn` in +07:00) backed strictly by direct timestamp evidence
 */
export async function queryMyTasks(client, config, args = {}) {
  const nowMs = Date.now();
  let dateVn = args.date_vn ? String(args.date_vn).trim() : null;
  if (dateVn && /^(today|yesterday)$/i.test(dateVn)) {
    const offsetDays = dateVn.toLowerCase() === 'yesterday' ? -1 : 0;
    const vnNow = new Date(nowMs + 7 * 3600 * 1000 + offsetDays * 86400000);
    const pad = n => String(n).padStart(2, '0');
    dateVn = `${vnNow.getUTCFullYear()}-${pad(vnNow.getUTCMonth() + 1)}-${pad(vnNow.getUTCDate())}`;
  }
  if ((dateVn && !/^\d{4}-\d{2}-\d{2}$/.test(dateVn)) || (dateVn && (args.date_from || args.date_to))) {
    throw new MisApiError('INVALID_ARGUMENT', 'Use date_vn (YYYY-MM-DD or today/yesterday) or date_from/date_to', 400);
  }
  const hasPeriod = Boolean(dateVn || args.date_from || args.date_to);
  const within = dateBounds(dateVn || args.date_from, dateVn || args.date_to);
  const maxEvidence = dateVn ? 5 : 3;
  const maxTransitions = dateVn ? 5 : 3;
  const previewLen = dateVn ? 140 : 100;

  const workspaceRoot = config.workspaceRoot ? path.resolve(config.workspaceRoot) : path.dirname(getExportsRoot(config));
  let snapshot = null;
  if (args.snapshot_path) {
    const resolved = resolveConfinedPath(args.snapshot_path, workspaceRoot, 'snapshot_path');
    if (!fs.existsSync(resolved)) {
      throw new MisApiError('FILE_NOT_FOUND', `Snapshot file not found: ${resolved}`, 404);
    }
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (parsed.files?.fullSnapshot) {
      const nested = resolveConfinedPath(parsed.files.fullSnapshot, workspaceRoot, 'snapshot_path');
      snapshot = JSON.parse(fs.readFileSync(nested, 'utf8'));
    } else {
      snapshot = parsed;
    }
  }

  let targetUser = null;
  if (args.user_id || args.email) {
    targetUser = { id: args.user_id || null, email: args.email || null, full_name: null, role: null };
    if (!targetUser.id && args.email && !snapshot) {
      try {
        const lookedUp = await client.request('GET', '/api/v1/users/lookup', { query: { email: args.email } });
        if (lookedUp?.id) {
          targetUser = { id: lookedUp.id, email: lookedUp.email || args.email, full_name: lookedUp.full_name || null, role: lookedUp.role || null };
        }
      } catch {
        // fallback to matching from project members/assignees
      }
    }
  } else if (snapshot?.account?.me) {
    const u = snapshot.account.me;
    targetUser = { id: u.id || null, email: u.email || null, full_name: u.full_name || null, role: u.role || null };
  } else {
    const meRes = await client.request('GET', '/api/v1/auth/me');
    const u = meRes?.user || meRes || {};
    targetUser = { id: u.id || null, email: u.email || null, full_name: u.full_name || null, role: u.role || null };
  }

  const warnings = [];
  let projectBundles;
  if (snapshot) {
    projectBundles = Array.isArray(snapshot.projects) ? snapshot.projects : [];
    if (args.project_id) {
      projectBundles = projectBundles.filter(b => b.project?.id === args.project_id);
    }
  } else {
    let projectList = [];
    if (args.project_id) {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const detail = await client.request('GET', `/api/v1/projects/${pid}`);
      projectList = [detail || { id: args.project_id }];
    } else {
      const list = await client.request('GET', '/api/v1/projects/');
      projectList = Array.isArray(list) ? list : [];
    }

    projectBundles = await mapLimit(projectList, 4, async proj => {
      const pid = assertSafeSegment(proj.id, 'project_id');
      const tasks = await safeGet(client, `/api/v1/projects/${pid}/tasks/`, {}, warnings, `project:${proj.id}:tasks`);
      return {
        project: proj,
        members: [],
        tasks: Array.isArray(tasks) ? tasks : []
      };
    });
  }

  targetUser = enrichTargetUserFromBundles(projectBundles, targetUser);
  if (!targetUser.id && !targetUser.email) {
    throw new MisApiError('IDENTITY_UNAVAILABLE', 'No MIS user ID or email was resolved', 422);
  }

  const byStatus = { TODO: 0, IN_PROGRESS: 0, INTERNAL_REVIEW: 0, MENTOR_REVIEW: 0, DONE: 0 };
  const buckets = {
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    claimable_open: []
  };

  const includeDone = Boolean(args.include_done) || args.status === 'DONE';
  const includeClaimable = args.include_claimable !== false;
  let overdueNonDoneCount = 0;

  const workedOnDate = [];
  const completedOnDate = [];
  const deadlineOnDate = [];
  const reviewOnDate = [];
  const claimedOnDate = [];

  for (const bundle of projectBundles) {
    const project = bundle.project || {};
    for (const task of bundle.tasks || []) {
      if (task.is_deleted) continue;
      const assigned = isUserAssignedToTask(task, targetUser);
      const summary = summarizeTask(project, task, nowMs);

      if (assigned) {
        if (byStatus[task.status] !== undefined) byStatus[task.status] += 1;
        else byStatus[task.status] = 1;
        if (summary.is_overdue) overdueNonDoneCount += 1;

        if (!args.status || task.status === args.status) {
          if (task.status === 'TODO') buckets.todo.push(summary);
          else if (task.status === 'IN_PROGRESS') buckets.in_progress.push(summary);
          else if (task.status === 'INTERNAL_REVIEW' || task.status === 'MENTOR_REVIEW') buckets.in_review.push(summary);
          else if (task.status === 'DONE' && includeDone) buckets.done.push(summary);
        }
      } else if (includeClaimable && task.is_claimable && !task.assignee_id && !task.assignees?.length && task.status !== 'DONE') {
        buckets.claimable_open.push(summary);
      }

      if (hasPeriod) {
        const directUserEvidence = [];
        const doneTransitions = [];
        const reviewTransitions = [];

        if (assigned && within(task.claimed_at)) {
          claimedOnDate.push({ ...compactPeriodTask(summary), claimed_at_vn: toVnTimestamp(task.claimed_at), actor_user_id: null });
        }

        for (const c of task.comments || []) {
          if (!within(c.created_at)) continue;
          const isUserComment = targetUser.id && c.user_id === targetUser.id;
          if (isUserComment) {
            directUserEvidence.push({
              source: 'task_comment',
              source_id: c.id || null,
              type: c.is_system_log ? 'system_log' : 'comment',
              timestamp_vn: toVnTimestamp(c.created_at),
              content_preview: String(c.content || '').replace(/<[^>]+>/g, '').slice(0, previewLen)
            });
          }
          const transition = statusTransition(c);
          if (assigned && transition?.to_status === 'DONE') {
            doneTransitions.push({
              ...transition,
              type: 'status_done_transition',
              timestamp_vn: toVnTimestamp(c.created_at),
              content_preview: String(c.content || '').slice(0, previewLen)
            });
          }
          if (transition && (assigned || isUserComment)
            && ['INTERNAL_REVIEW', 'MENTOR_REVIEW', 'DONE'].includes(transition.to_status)) {
            reviewTransitions.push({ ...transition, timestamp_vn: toVnTimestamp(c.created_at) });
          }
        }

        for (const r of task.reports || []) {
          const ts = r.created_at;
          if (!within(ts)) continue;
          const rUid = r.user_id || r.user?.id || null;
          const rEmail = r.user?.email || null;
          if (matchesTargetUser(targetUser, rUid, rEmail)) {
            directUserEvidence.push({
              source: 'task_report',
              source_id: r.id || null,
              type: 'report',
              timestamp_vn: toVnTimestamp(ts),
              content_preview: String(r.report_text || r.file_name || r.report_link_url || 'Submitted report').slice(0, previewLen)
            });
          }
        }

        if (directUserEvidence.length > 0) {
          workedOnDate.push({
            ...compactPeriodTask(summary),
            is_assigned_to_user: assigned,
            evidence_count: directUserEvidence.length,
            ...(directUserEvidence.length > maxEvidence ? { evidence_truncated: true } : {}),
            evidence: directUserEvidence.slice(0, maxEvidence)
          });
        }

        if (doneTransitions.length > 0) {
          completedOnDate.push({
            ...compactPeriodTask(summary),
            done_transition_count: doneTransitions.length,
            done_transitions: doneTransitions.slice(0, maxTransitions)
          });
        }

        if (reviewTransitions.length > 0) {
          reviewOnDate.push({
            ...compactPeriodTask(summary),
            is_assigned_to_user: assigned,
            transition_count: reviewTransitions.length,
            transitions: reviewTransitions.slice(0, maxTransitions)
          });
        }

        if (assigned && within(task.deadline)) {
          deadlineOnDate.push({
            ...compactPeriodTask(summary),
            evidence_type: 'deadline_only'
          });
        }
      }
    }
  }

  const totalAssigned = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const offset = args.offset ?? 0;
  const limit = args.limit ?? 25;
  const paginate = items => pageOf(items, offset, limit);
  const bucketPages = Object.fromEntries(Object.entries(buckets).map(([key, items]) => [key, paginate(items)]));
  const result = {
    sourceMode: snapshot ? 'snapshot' : 'live',
    checkedAtVn: toVnTimestamp(new Date(nowMs).toISOString()),
    timezone: 'Asia/Saigon (+07:00)',
    dataSources: snapshot
      ? [args.snapshot_path]
      : [...(!args.user_id && !args.email ? ['GET /api/v1/auth/me'] : []),
        args.project_id ? 'GET /api/v1/projects/{project_id}' : 'GET /api/v1/projects/',
        'GET /api/v1/projects/{project_id}/tasks/'],
    schemaCaveat: 'Task lists expose current state and visible system comments. DONE events apply to the current assignment cohort; actor IDs identify who logged the transition. Assignment history, formal approval and historical state as of a date are unavailable here. Claim time has no actor ID.',
    coverage: warnings.length ? 'partial' : 'visible_sources',
    targetUser,
    scannedProjectsCount: projectBundles.length,
    scannedProjects: projectBundles.map(b => ({ id: b.project?.id || null, name: b.project?.name || null })),
    summary: {
      totalAssigned,
      byStatus,
      actionableCount: (byStatus.TODO || 0) + (byStatus.IN_PROGRESS || 0),
      inReviewCount: (byStatus.INTERNAL_REVIEW || 0) + (byStatus.MENTOR_REVIEW || 0),
      doneCount: byStatus.DONE || 0,
      overdueNonDoneCount,
      claimableOpenCount: buckets.claimable_open.length
    },
    buckets: Object.fromEntries(Object.entries(bucketPages).map(([key, page]) => [key, page.items])),
    bucketPagination: Object.fromEntries(Object.entries(bucketPages).map(([key, { items, ...page }]) => [key, page])),
    ...(warnings.length > 0 ? { warnings } : {})
  };

  if (hasPeriod) {
    const groups = {
      worked_on_date: workedOnDate,
      completed_on_date: completedOnDate,
      deadline_on_date: deadlineOnDate,
      review_on_date: reviewOnDate,
      claimed_on_date: claimedOnDate
    };
    const pages = Object.fromEntries(Object.entries(groups).map(([key, items]) => [key, paginate(items)]));
    const analysis = {
      ...(dateVn ? { date_vn: dateVn } : { date_from: args.date_from || null, date_to: args.date_to || null }),
      workedOnDateCount: workedOnDate.length,
      completedOnDateCount: completedOnDate.length,
      deadlineOnDateCount: deadlineOnDate.length,
      reviewOnDateCount: reviewOnDate.length,
      claimedOnDateCount: claimedOnDate.length,
      ...Object.fromEntries(Object.entries(pages).map(([key, page]) => [key, page.items])),
      pagination: Object.fromEntries(Object.entries(pages).map(([key, { items, ...page }]) => [key, page]))
    };
    result[dateVn ? 'dateAnalysis' : 'periodAnalysis'] = analysis;
  }

  return result;
}

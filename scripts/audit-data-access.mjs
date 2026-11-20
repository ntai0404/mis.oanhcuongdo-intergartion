import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../src/config.mjs';
import { createToolRegistry } from '../src/tools.mjs';
import { statusTransition, taskChange } from '../src/data-access.mjs';

const config = loadConfig();
const origin = 'https://mis.oanhcuongdo.com';
if (config.baseUrl !== origin || !config.token) throw new Error('A configured MIS session is required');

const observations = {};
const samples = {};
async function read(route, { label = route, web = false, binary = false, anonymous = false } = {}) {
  const url = new URL(route, origin);
  if (url.origin !== origin) throw new Error('Unexpected origin');
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: anonymous ? {} : web ? { Cookie: `access_token=${config.token}` } : { Authorization: `Bearer ${config.token}` }
    });
    const contentType = response.headers.get('content-type') || '';
    observations[label] = { status: response.status, contentType };
    if (!response.ok || binary) {
      await response.body?.cancel();
      return null;
    }
    if (contentType.includes('application/json')) return await response.json();
    if (contentType.includes('text/html')) return await response.text();
    await response.body?.cancel();
  } catch (error) {
    observations[label] = { error: error.cause?.code || error.name };
  }
  return null;
}

// Record field paths and value types only. No values from account records are exported.
function shape(value) {
  const fields = new Map();
  function visit(item, at) {
    const type = item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item;
    if (!fields.has(at)) fields.set(at, new Set());
    fields.get(at).add(type);
    if (type === 'array') for (const child of item) visit(child, at + '[]');
    if (type === 'object') {
      for (const [key, child] of Object.entries(item)) {
        const field = /^[a-z_][a-z_0-9]{0,60}$/i.test(key) ? key : '{key}';
        visit(child, at + '.' + field);
      }
    }
  }
  visit(value, '$');
  return Object.fromEntries([...fields.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([at, types]) => [at, [...types].sort()]));
}

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const spec = await read('/openapi.json');
if (!spec?.paths) throw new Error(`OpenAPI unavailable: ${JSON.stringify(observations['/openapi.json'])}`);
const operations = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
  .filter(([method]) => methods.has(method))
  .map(([method, operation]) => ({
    path, method, tags: operation.tags, operationId: operation.operationId,
    security: operation.security ?? spec.security ?? null,
    parameters: [...(item.parameters || []), ...(operation.parameters || [])],
    responses: operation.responses
  })));

async function sample(label, route = label, options = {}) {
  const data = await read(route, { label, ...options });
  if (data !== null && typeof data !== 'string') {
    samples[label] = { count: Array.isArray(data) ? data.length : undefined, shape: shape(data) };
  }
  return data;
}

const api = '/api/v1';
const [identity, projects, courses, videos] = await Promise.all([
  sample(api + '/auth/me'), sample(api + '/projects/'), sample(api + '/courses'),
  sample(api + '/gallery/videos', api + '/gallery/videos?page=1&page_size=1')
]);
const projectList = Array.isArray(projects) ? projects : [];
const projectTasks = [];
for (const { id } of projectList) {
  const path = `${api}/projects/${encodeURIComponent(id)}/tasks/`;
  projectTasks.push(await read(path, { label: `project tasks sample ${projectTasks.length + 1}` }));
}
const allTasks = projectTasks.flatMap(tasks => tasks || []);
samples['accessible project task lists'] = { count: allTasks.length, shape: shape(allTasks) };
const project = projectList[projectTasks.indexOf(projectTasks.find(tasks => tasks?.some(task => task.reports?.length)))] || projectList[0];
const tasks = projectTasks[projectList.indexOf(project)] || [];
const task = tasks.find(item => item.reports?.some(report => report.file_name)) || tasks[0];
const report = task?.reports?.find(item => item.file_name) || task?.reports?.[0];
const course = Array.isArray(courses) ? courses[0] : null;
const ids = { project_id: project?.id, task_id: task?.id, report_id: report?.id, course_id: course?.id };

function fill(path) {
  if (path.match(/\{([^}]+)\}/g)?.some(key => !ids[key.slice(1, -1)])) return null;
  return path.replace(/\{([^}]+)\}/g, (_, key) => encodeURIComponent(ids[key]));
}
if (project) {
  const path = '/api/v1/projects/{project_id}/documents/';
  const docs = await sample(path, fill(path));
  let documentProject = project;
  let documents = docs;
  for (const candidate of projectList.filter(item => item.id !== project.id)) {
    if (documents?.length) break;
    const documentRoute = `${api}/projects/${encodeURIComponent(candidate.id)}/documents/`;
    documents = await sample('project documents additional sample', documentRoute);
    documentProject = candidate;
  }
  ids.project_document_id = (documents?.find(doc => doc.file_name || doc.file_url) || documents?.[0])?.id;
  ids.document_project_id = documentProject.id;
}
if (course) {
  for (const [resource, key] of [['assignments', 'assignment_id'], ['documents', 'course_document_id']]) {
    const path = `${api}/courses/{course_id}/${resource}`;
    const records = await sample(path, fill(path));
    ids[key] = records?.[0]?.id;
  }
}
ids.slug = (videos?.items || videos?.videos || videos)?.[0]?.slug;
const galleryDocsPath = api + '/gallery/documents';
const galleryDocs = await sample(galleryDocsPath, galleryDocsPath + '?page=1');
ids.course_document_id ??= galleryDocs?.items?.[0]?.id;

const skipped = {};
const ui = {};
async function webPage(path, label) {
  const html = await read(path, { label, web: true });
  if (typeof html !== 'string') return;
  ui[label] = {
    paths: [...new Set(html.match(/\/api\/[\w/.${}-]+/g) || [])]
      .map(value => value.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '{id}')).sort(),
    controls: [...new Set([...html.matchAll(/\bid="([a-z][\w-]+)"/gi)].map(match => match[1]))].sort()
  };
  const digestCall = html.match(/fetch\(\s*['"]\/api\/ai-digest['"]([\s\S]{0,150})/);
  if (digestCall) {
    ui[label].aiDigestFetchMethod = digestCall[1].match(/method\s*:\s*['"]([A-Z]+)['"]/i)?.[1]
      || (digestCall[1].trimStart().startsWith(')') ? 'GET' : 'unspecified');
  }
  if (/href=["']\/api\/ai-digest\b/.test(html)) ui[label].aiDigestAnchor = true;
  return html;
}

let taskDetail;
let projectFeed;
for (const op of operations) {
  const { path, method } = op;
  const label = `${method.toUpperCase()} ${path}`;
  if (method !== 'get') { skipped[label] = 'Non-GET'; continue; }
  if (/\/google\/|\/join\/|\/ai-summary$|\/group-profile$|\/download-file$/.test(path)) {
    skipped[label] = 'Session, invite, generation, refresh or URL-based operation';
    continue;
  }
  if (observations[path]) continue;
  if (path === api + '/sync/tlu/status/{task_id}') {
    skipped[label] = 'No TLU sync-job identifier';
    continue;
  }
  const documentId = path.includes('/projects/') || path.includes('/project-documents/')
    ? ids.project_document_id : ids.course_document_id;
  ids.document_id = documentId;
  const route = fill(path.endsWith('/documents/{document_id}') && path.includes('/projects/')
    ? path.replace('{project_id}', '{document_project_id}') : path);
  if (!route) { skipped[label] = 'No authorized sample identifier'; continue; }
  const query = new URLSearchParams();
  if (path.endsWith('/users/lookup')) {
    if (!identity?.user?.email) { skipped[label] = 'No account email'; continue; }
    query.set('email', identity.user.email);
  }
  for (const p of op.parameters) {
    if (p.name === 'page' || p.name === 'page_size') query.set(p.name, '1');
  }
  const target = query.size ? `${route}?${query}` : route;
  if (path.startsWith('/projects/')) await webPage(target, path);
  else {
    const data = await sample(path, target, { binary: /\/download$|\/file$|\/stream$|\/export$|\/export-/.test(path) });
    if (path.endsWith('/tasks/{task_id}')) taskDetail = data;
    if (path.endsWith('/feed')) projectFeed = data;
  }
}

for (const path of ['/dashboard', '/courses', '/gallery']) await webPage(path, path);
await read(api + '/projects/', { label: 'project list without session', anonymous: true });
await read('/projects/', { label: 'project page without session', anonymous: true });
if (project && task) {
  const page = fill('/projects/{project_id}');
  const html = await webPage(`${page}?task_id=${encodeURIComponent(task.id)}`, 'project task deep link');
  ui['project task deep link'] ??= {};
  ui['project task deep link'].ssrContainsTaskTitle = Boolean(task.title && html?.includes(task.title));
}

const statusLogs = {};
const changeLogs = {};
for (const task of allTasks) {
  for (const comment of task.comments || []) {
    const transition = statusTransition(comment)?.to_status;
    const change = taskChange(comment)?.change;
    if (transition) statusLogs[transition] = (statusLogs[transition] || 0) + 1;
    if (change) changeLogs[change] = (changeLogs[change] || 0) + 1;
  }
}
const feedIds = new Set((projectFeed?.feed || []).map(event => event.id).filter(Boolean));
const cookieFeed = project && await sample('project feed via Web session cookie', fill(api + '/projects/{project_id}/feed'), { web: true });
const comparisons = {
  listAndDetailSameTask: Boolean(taskDetail && task && taskDetail.id === task.id),
  listAndDetailFieldsAgree: taskDetail && task
    ? ['status', 'parent_id', 'deadline', 'assignee_id', 'checklists', 'comments', 'reports']
      .every(key => JSON.stringify(taskDetail[key]) === JSON.stringify(task[key]))
    : null,
  feedOverlapWithTaskCommentIds: tasks.flatMap(item => item.comments || []).filter(comment => feedIds.has(comment.id)).length,
  feedCountForSampleProject: projectFeed?.feed?.length,
  cookieAndBearerFeedIdsAgree: Boolean(cookieFeed && projectFeed
    && JSON.stringify(cookieFeed.feed.map(row => row.id)) === JSON.stringify(projectFeed.feed.map(row => row.id))),
  subtasks: allTasks.filter(item => item.parent_id).length
};
const evidence = {
  observedAt: new Date().toISOString(),
  accountRole: identity?.user?.role,
  openapiVersion: spec.openapi,
  operations,
  schemas: spec.components?.schemas,
  tools: createToolRegistry({}, {}).tools,
  observations, skipped, samples, ui, statusLogs, changeLogs, comparisons,
  accessibleProjects: projectList.length
};
mkdirSync(new URL('../reports/', import.meta.url), { recursive: true });
writeFileSync(new URL('../reports/mis-data-access-audit.json', import.meta.url), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  operations: operations.length, schemas: Object.keys(evidence.schemas || {}).length,
  tools: evidence.tools.length, projects: evidence.accessibleProjects, tasks: allTasks.length,
  role: evidence.accountRole, observations, statusLogs, changeLogs, comparisons
}, null, 2));

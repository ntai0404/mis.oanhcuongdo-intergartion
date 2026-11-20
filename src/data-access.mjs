import { MisApiError, assertSafeSegment } from './client.mjs';

const STATUS = 'TODO|IN_PROGRESS|INTERNAL_REVIEW|MENTOR_REVIEW|DONE';
const statusPattern = new RegExp(`^chuyển trạng thái sang\\s*['"](${STATUS})['"]`, 'iu');

function systemAction(comment) {
  if (comment.is_system_log !== true || !Number.isFinite(Date.parse(comment.created_at))) return '';
  return String(comment.content || '').split(/\s+đã\s+/iu, 2)[1] || '';
}

export function toVnTimestamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +07:00`;
}

export function loggedActorName(comment) {
  if (comment?.is_system_log !== true) return null;
  const parts = String(comment.content || '').split(/\s+đã\s+/iu, 2);
  return parts.length === 2 ? parts[0].trim() || null : null;
}

export function dateBounds(from, to) {
  function parse(value, end) {
    if (!value) return null;
    const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const utcDate = day ? Date.parse(value) : null;
    if (day && (!Number.isFinite(utcDate) || !new Date(utcDate).toISOString().startsWith(value))) {
      throw new MisApiError('INVALID_ARGUMENT', `Invalid calendar date: ${value}`, 400);
    }
    const ms = Date.parse(day ? `${value}T${end ? '23:59:59.999' : '00:00:00'}+07:00` : value);
    if (!Number.isFinite(ms) || (!day && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))) {
      throw new MisApiError('INVALID_ARGUMENT', 'Use YYYY-MM-DD or ISO 8601 with a timezone offset', 400);
    }
    return ms;
  }
  const start = parse(from, false);
  const end = parse(to, true);
  if (start !== null && end !== null && start > end) {
    throw new MisApiError('INVALID_ARGUMENT', 'Start date must precede end date', 400);
  }
  return timestamp => {
    const ms = Date.parse(timestamp);
    return Number.isFinite(ms) && (start === null || ms >= start) && (end === null || ms <= end);
  };
}

export function statusTransition(comment) {
  const status = systemAction(comment).match(statusPattern)?.[1]?.toUpperCase();
  if (!status) return null;
  return {
    source: 'task_comment',
    source_id: comment.id ?? null,
    evidence: 'system_log',
    to_status: status,
    actor_user_id: comment.user_id ?? null,
    actor_name: loggedActorName(comment),
    created_at: comment.created_at,
    timestamp_vn: toVnTimestamp(comment.created_at)
  };
}

export function taskChange(comment) {
  const action = systemAction(comment);
  let change;
  if (/^(?:giao việc cho|thay đổi người phụ trách)(?:\s|[.:]|$)/iu.test(action)) change = 'assignment';
  else if (/^đánh dấu (?:bỏ )?hoàn thành checklist(?:\s|[.:]|$)/iu.test(action)) change = 'checklist';
  if (!change) return null;
  return {
    source: 'task_comment',
    source_id: comment.id ?? null,
    evidence: 'system_log',
    change,
    actor_user_id: comment.user_id ?? null,
    actor_name: loggedActorName(comment),
    created_at: comment.created_at,
    timestamp_vn: toVnTimestamp(comment.created_at),
    content_preview: String(comment.content).slice(0, 240)
  };
}

export function pageOf(items, offset, limit) {
  const page = items.slice(offset, offset + limit);
  return {
    total: items.length,
    offset,
    next_offset: offset + page.length < items.length ? offset + page.length : null,
    items: page
  };
}

function resolveNamedRecord(items, name, field, resource) {
  const normalize = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const search = normalize(name);
  if (!search) throw new MisApiError('INVALID_ARGUMENT', `${field} must not be blank`, 400);
  const exact = items.filter(item => normalize(item[field]) === search);
  const matches = exact.length ? exact : items.filter(item => normalize(item[field]).includes(search));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new MisApiError(`${resource}_NOT_FOUND`, `No visible ${resource.toLowerCase()} matches ${name}`, 404);
  throw new MisApiError(`AMBIGUOUS_${resource}`, `Multiple visible matches for ${name}; use the ID or a more specific name`, 409, {
    total: matches.length,
    candidates: matches.slice(0, 10).map(item => ({ id: item.id, [field]: item[field] }))
  });
}

export async function readTask(client, args) {
  if (Boolean(args.project_id) === Boolean(args.project_name) || Boolean(args.task_id) === Boolean(args.task_title)) {
    throw new MisApiError('INVALID_ARGUMENT', 'Supply one of project_id or project_name and one of task_id or task_title', 400);
  }
  const isHistory = args.view === 'history' || args.view === 'review';
  const hasHistoryFilters = [args.date_from, args.date_to, args.offset, args.limit].some(value => value !== undefined);
  if (!isHistory && hasHistoryFilters) {
    throw new MisApiError('INVALID_ARGUMENT', 'Date and paging arguments require view=history or view=review', 400);
  }
  const within = isHistory ? dateBounds(args.date_from, args.date_to) : null;

  const project = args.project_name
    ? resolveNamedRecord(await client.request('GET', '/api/v1/projects/'), args.project_name, 'name', 'PROJECT')
    : null;
  const root = `/api/v1/projects/${assertSafeSegment(project?.id ?? args.project_id, 'project_id')}/tasks/`;
  const taskId = args.task_title
    ? resolveNamedRecord((await client.request('GET', root)).filter(task => !task.is_deleted), args.task_title, 'title', 'TASK').id
    : args.task_id;
  const task = await client.request('GET', root + assertSafeSegment(taskId, 'task_id'));
  if (isHistory) {
    const history = taskHistory(task, args, within);
    return project ? { ...history, project_id: project.id, project_name: project.name } : history;
  }

  const comments = task.comments || [];
  const comment_counts = { total: comments.length, manual: 0, system_log: 0, unclassified: 0 };
  for (const comment of comments) {
    const flag = comment?.is_system_log;
    if (flag === true) comment_counts.system_log += 1;
    else if (flag === false) comment_counts.manual += 1;
    else comment_counts.unclassified += 1;
  }
  if (args.view !== 'summary') return { ...task, comment_counts };

  const preview = value => typeof value === 'string' ? value.slice(0, 240) : null;
  const checklists = task.checklists || [];
  const reports = task.reports || [];
  return {
    id: task.id,
    title: task.title,
    project_id: project?.id ?? args.project_id,
    project_name: project?.name,
    status: task.status,
    description: task.description,
    parent_id: task.parent_id,
    deadline: task.deadline,
    deadline_vn: toVnTimestamp(task.deadline),
    assignee_id: task.assignee_id,
    assignees: task.assignees,
    estimated_hours: task.estimated_hours,
    actual_hours: task.actual_hours,
    checklist_counts: { total: checklists.length, completed: checklists.filter(item => item.is_completed === true).length },
    checklists,
    comment_counts,
    manual_comment_previews: comments.filter(comment => comment?.is_system_log === false).slice(0, 5)
      .map(({ id, user_id, created_at, content }) => ({ id, user_id, created_at, content_preview: preview(content) })),
    report_count: reports.length,
    reports: reports.map(({ id, user_id, user, created_at, report_text, report_link_url, file_name, file_size_bytes }) => ({
      id, user_id, author_name: user?.full_name ?? null, created_at, report_text_preview: preview(report_text),
      report_text_truncated: typeof report_text === 'string' && report_text.length > 240,
      report_link_url, file_name, file_size_bytes
    }))
  };
}

function taskHistory(task, args, within) {
  const reviewOnly = args.view === 'review';
  const events = (task.comments || []).map(statusTransition)
    .filter(event => event && within(event.created_at)
      && (!reviewOnly || event.to_status === 'INTERNAL_REVIEW' || event.to_status === 'MENTOR_REVIEW'))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const paginate = items => pageOf(items, args.offset ?? 0, args.limit ?? 25);
  const history = {
    task_id: task.id,
    title: task.title || '',
    current_status: task.status,
    current_assignee_ids: [...new Set([task.assignee_id, ...(task.assignees || []).map(user => user.id)].filter(Boolean))],
    current_assignees: (task.assignees || []).map(u => ({ id: u.id || null, full_name: u.full_name || null })),
    source: 'task.comments where is_system_log=true and the log explicitly describes the change',
    coverage: reviewOnly
      ? 'Visible transitions into INTERNAL_REVIEW or MENTOR_REVIEW. Actor IDs and names come from the logged events. Formal approval and previous status may be unavailable.'
      : 'Actor IDs identify logged actors; actor_name is extracted from the logged system message text when present. Visible assignment and checklist events cover only explicit log messages. Previous status, original assigner and formal approval may be unavailable.',
    transitions: paginate(events)
  };
  if (reviewOnly) return history;
  const changes = (task.comments || []).map(taskChange)
    .filter(event => event && within(event.created_at))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return {
    ...history,
    assignment_events: paginate(changes.filter(event => event.change === 'assignment')),
    checklist_events: paginate(changes.filter(event => event.change === 'checklist'))
  };
}

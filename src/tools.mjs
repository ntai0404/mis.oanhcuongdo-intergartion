import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MisApiError, assertSafeSegment } from './client.mjs';
import { saveEnvToken } from './config.mjs';
import { extractAccessTokenFromCdp } from './cdp-auth.mjs';
import { findRunningNativeChromeCdp, inspectJwt } from './auth-manager.mjs';
import { collectAccountData, queryMyTasks, queryUserLogs } from './collector.mjs';
import { pageOf, readTask } from './data-access.mjs';

const CHUNK_SIZE = 5 * 1024 * 1024;

function strProp(description, extra = {}) {
  return { type: 'string', description, ...extra };
}
function intProp(description, extra = {}) {
  return { type: 'integer', description, ...extra };
}
function numProp(description, extra = {}) {
  return { type: 'number', description, ...extra };
}
function boolProp(description, extra = {}) {
  return { type: 'boolean', description, ...extra };
}
function strArrayProp(description) {
  return { type: 'array', items: { type: 'string' }, description };
}

function defTool(name, description, properties, required, readOnlyHint, destructiveHint, handler) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false
    },
    annotations: {
      readOnlyHint,
      destructiveHint,
      openWorldHint: true
    },
    handler
  };
}

function validateArgs(tool, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new MisApiError('INVALID_ARGUMENTS', 'Arguments must be a JSON object', 400);
  }
  const props = tool.inputSchema.properties;
  for (const key of Object.keys(args)) {
    const schema = props[key];
    if (!schema) {
      throw new MisApiError('UNKNOWN_ARGUMENT', `Unknown argument: ${key}`, 400);
    }
    const val = args[key];
    if (schema.type === 'string') {
      if (typeof val !== 'string') throw new MisApiError('INVALID_ARGUMENT', `${key} must be a string`, 400);
      if (schema.minLength !== undefined && val.length < schema.minLength) {
        throw new MisApiError('INVALID_ARGUMENT', `${key} must be non-empty`, 400);
      }
      if (schema.enum && !schema.enum.includes(val)) {
        throw new MisApiError('INVALID_ARGUMENT', `${key} must be one of: ${schema.enum.join(', ')}`, 400);
      }
    } else if (schema.type === 'integer') {
      if (!Number.isInteger(val)) throw new MisApiError('INVALID_ARGUMENT', `${key} must be an integer`, 400);
      if (schema.minimum !== undefined && val < schema.minimum) throw new MisApiError('INVALID_ARGUMENT', `${key} < minimum ${schema.minimum}`, 400);
      if (schema.maximum !== undefined && val > schema.maximum) throw new MisApiError('INVALID_ARGUMENT', `${key} > maximum ${schema.maximum}`, 400);
    } else if (schema.type === 'number') {
      if (typeof val !== 'number' || Number.isNaN(val)) throw new MisApiError('INVALID_ARGUMENT', `${key} must be a number`, 400);
    } else if (schema.type === 'boolean') {
      if (typeof val !== 'boolean') throw new MisApiError('INVALID_ARGUMENT', `${key} must be a boolean`, 400);
    } else if (schema.type === 'array') {
      if (!Array.isArray(val) || !val.every(x => typeof x === 'string')) {
        throw new MisApiError('INVALID_ARGUMENT', `${key} must be an array of strings`, 400);
      }
    } else if (schema.type === 'object') {
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        throw new MisApiError('INVALID_ARGUMENT', `${key} must be an object`, 400);
      }
    }
  }
  for (const reqKey of tool.inputSchema.required) {
    if (args[reqKey] === undefined) {
      throw new MisApiError('MISSING_ARGUMENT', `Missing required argument: ${reqKey}`, 400);
    }
  }
}

export function createToolRegistry(client, config, deps = {}) {
  const cdpExtractor = deps.extractAccessTokenFromCdp || extractAccessTokenFromCdp;
  const tokenSaver = deps.saveEnvToken || saveEnvToken;

  const list = [
    // ── Auth & Discovery (Read-only) ──
    defTool('mis_health', 'Check Matrix AI EDU API health status (GET /api/v1/health)', {}, [], true, false,
      async () => await client.request('GET', '/api/v1/health', { skipAuth: true })),

    defTool('mis_get_me', 'Get currently authenticated user profile and role (GET /api/v1/auth/me)', {}, [], true, false,
      async () => await client.request('GET', '/api/v1/auth/me')),

    defTool('mis_get_tlu_status', 'Get TLU account link and sync status for current user (GET /api/v1/auth/tlu/status)', {}, [], true, false,
      async () => await client.request('GET', '/api/v1/auth/tlu/status')),

    defTool('mis_lookup_user', 'Lookup a user by exact email address (GET /api/v1/users/lookup)', {
      email: strProp('Email address to look up', { minLength: 3 })
    }, ['email'], true, false,
      async args => await client.request('GET', '/api/v1/users/lookup', { query: { email: args.email } })),

    defTool('mis_refresh_token_from_cdp', 'Read-only extract access_token cookie from a running local Native Chrome CDP session (/browse-open) and store it in .env.mis without echoing the raw token', {
      cdpEndpoint: strProp('Loopback Chrome CDP endpoint (auto-detects running /browse-open Native Chrome or defaults to MIS_CDP_ENDPOINT)', { minLength: 1 })
    }, [], true, false, async args => {
      let endpoint = args.cdpEndpoint;
      let discoverySource = 'explicit_arg';
      if (!endpoint) {
        const running = await (deps.findRunningNativeChromeCdp || findRunningNativeChromeCdp)(config, deps);
        endpoint = running?.endpoint || config.cdpEndpoint;
        discoverySource = running?.source || 'config_default';
      }
      const res = await cdpExtractor(endpoint, `${config.baseUrl}/`, config.timeoutMs);
      const jwtMeta = inspectJwt(res.token);
      if (jwtMeta.validFormat && jwtMeta.isExpired) {
        throw new MisApiError('SESSION_EXPIRED', `access_token cookie in Native Chrome (${endpoint}) is already expired (${jwtMeta.expiresAtVn}); please sign in again via /browse-open.`, 401);
      }
      client.setToken(res.token);
      tokenSaver(config.envFile, config.baseUrl, res.token);
      return {
        refreshed: true,
        cdpEndpoint: endpoint,
        discoverySource,
        domain: res.domain,
        expires: res.expires,
        issuedAtVn: jwtMeta.issuedAtVn || null,
        expiresAtVn: jwtMeta.expiresAtVn || null,
        remainingDays: jwtMeta.remainingDays ?? null,
        envFile: config.envFile,
        tokenPreview: res.token.slice(0, 12) + '...'
      };
    }),

    // ── Projects & Analytics (Read-only) ──
    defTool('mis_list_projects', 'List projects accessible to the authenticated user (GET /api/v1/projects/)', {
      course_id: strProp('Optional filter by course UUID', { minLength: 1 })
    }, [], true, false,
      async args => await client.request('GET', '/api/v1/projects/', { query: { course_id: args.course_id } })),

    defTool('mis_get_project', 'Get detailed project metadata, members, and invite token (GET /api/v1/projects/{project_id})', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}`)),

    defTool('mis_get_project_members', 'List member user_ids and roles of a project (GET /api/v1/projects/{project_id}/members; returns project_id, user_id, role only without display names/emails)', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/members`)),

    defTool('mis_get_project_feed', 'Get raw unpaginated project feed (up to 50 items, display-name only without actor IDs). For recent project activity with actor IDs, pagination, and compact output, prefer mis_get_user_logs with project_id, all_actors=true, compact=true.', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/feed`)),

    defTool('mis_get_project_performance', 'Get MIS Performance KPIs or task milestones (created, first viewed, accepted, completed) from the Performance API. Task milestone strings are backend-reported for the returned student cohort.', {
      project_id: strProp('Optional project UUID', { minLength: 1 }),
      student_id: strProp('Optional student UUID', { minLength: 1 }),
      date_from: strProp('Optional ISO start date (YYYY-MM-DD)', { minLength: 1 }),
      date_to: strProp('Optional ISO end date (YYYY-MM-DD)', { minLength: 1 }),
      task_id: strProp('Return only Performance milestone rows for this task. Requires project_id.', { minLength: 1 }),
      summary_only: boolProp('Return just the backend KPI summary for the selected scope')
    }, [], true, false,
      async args => {
        if (args.task_id && (!args.project_id || args.summary_only)) {
          throw new MisApiError('INVALID_ARGUMENT', 'task_id requires project_id and cannot be used with summary_only', 400);
        }
        const data = await client.request('GET', '/api/v1/projects/analytics/performance', {
          query: { project_id: args.project_id, student_id: args.student_id, date_from: args.date_from, date_to: args.date_to }
        });
        if (args.summary_only) return { summary: data.summary };
        if (!args.task_id) return data;
        return {
          source: 'GET /api/v1/projects/analytics/performance',
          task_id: args.task_id,
          coverage: 'Only Performance rows visible under the supplied filters. Milestone strings are returned as displayed by MIS.',
          milestones: (data.students || []).flatMap(student => (student.task_details || [])
            .filter(row => row.task_id === args.task_id && row.project_id === args.project_id)
            .map(row => ({
              student_id: student.user_id,
              created_at_iso: row.created_at_iso ?? null,
              first_viewed_at_str: row.first_viewed_at_str ?? null,
              accepted_at_str: row.accepted_at_str ?? null,
              claimed_at_str: row.claimed_at_str ?? null,
              completed_at_str: row.completed_at_str ?? null
            })))
        };
      }),

    // ── Project Tasks, Checklists & Reports (Read-only) ──
    defTool('mis_list_tasks', 'Find project tasks by title, assignee or parent (subtasks). Automatically uses compact paginated rows when search/assignee_id/parent_id/offset/limit or compact=true is set.', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      status: strProp('Server-side status filter', { enum: ['TODO', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'MENTOR_REVIEW', 'DONE'] }),
      compact: boolProp('Return compact task rows with pagination (auto-enabled when search/assignee_id/parent_id/offset/limit is set)'),
      search: strProp('Case-insensitive title substring (uses compact view)', { minLength: 1 }),
      assignee_id: strProp('Filter by current assignee UUID (uses compact view)', { minLength: 1 }),
      parent_id: strProp('Filter subtasks by parent task UUID (uses compact view)', { minLength: 1 }),
      offset: intProp('Compact result offset', { minimum: 0 }),
      limit: intProp('Compact page size (default 25)', { minimum: 1, maximum: 100 })
    }, ['project_id'], true, false,
      async args => {
        const hasCompactArgs = [args.search, args.assignee_id, args.parent_id, args.offset, args.limit].some(value => value !== undefined);
        if (args.compact === false && hasCompactArgs) {
          throw new MisApiError('INVALID_ARGUMENT', 'Search, assignee, parent and paging require compact=true', 400);
        }
        const useCompact = args.compact === true || hasCompactArgs;
        const items = await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/`, { query: { status: args.status } });
        if (!useCompact) return items;
        const search = args.search?.toLowerCase();
        const matches = items.filter(task => !task.is_deleted
          && (!args.parent_id || task.parent_id === args.parent_id)
          && (!args.assignee_id || task.assignee_id === args.assignee_id || task.assignees?.some(user => user.id === args.assignee_id))
          && (!search || task.title?.toLowerCase().includes(search)));
        const page = pageOf(matches, args.offset ?? 0, args.limit ?? 25);
        return {
          ...page,
          items: page.items.map(({ id, title, status, deadline, parent_id }) => ({ id, title, status, deadline, parent_id }))
        };
      }),

    defTool('mis_list_claimable_tasks', 'List open/claimable tasks in a project (GET /api/v1/projects/{project_id}/tasks/claimable)', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/claimable`)),

    defTool('mis_get_task', 'Read one task in a single MCP call. Use IDs if known or supply project_name and task_title directly. For details use summary with exact comment_counts from the raw task, checklist rows and report metadata/previews. For who moved it into review and when, use review with actors and +07:00 timestamps. Use full for verbatim comments/reports or history for all recognized transitions and changes.', {
      project_id: strProp('Project UUID, instead of project_name', { minLength: 1 }),
      project_name: strProp('Project name, instead of project_id. Exact match preferred.', { minLength: 1 }),
      task_id: strProp('Task UUID, instead of task_title', { minLength: 1 }),
      task_title: strProp('Task title, instead of task_id. Exact match preferred.', { minLength: 1 }),
      view: strProp('summary for task Q&A, review for review transitions only, history for all recognized events, full for raw data (default)', { enum: ['full', 'summary', 'history', 'review'] }),
      date_from: strProp('History/review start in +07:00 or ISO timestamp with timezone'),
      date_to: strProp('History/review end in +07:00 or ISO timestamp with timezone'),
      offset: intProp('History/review offset', { minimum: 0 }),
      limit: intProp('History/review page size (default 25)', { minimum: 1, maximum: 100 })
    }, [], true, false, async args => await readTask(client, args)),

    defTool('mis_view_task_report_log', 'Read text content of a submitted task report log file (GET .../reports/{report_id}/view-log)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      report_id: strProp('Report UUID', { minLength: 1 })
    }, ['project_id', 'task_id', 'report_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/${assertSafeSegment(args.task_id, 'task_id')}/reports/${assertSafeSegment(args.report_id, 'report_id')}/view-log`)),

    defTool('mis_download_task_report_file', 'Download an attached task report proof/archive into workspace downloads/ (GET .../reports/{report_id}/download)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      report_id: strProp('Report UUID', { minLength: 1 })
    }, ['project_id', 'task_id', 'report_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/${assertSafeSegment(args.task_id, 'task_id')}/reports/${assertSafeSegment(args.report_id, 'report_id')}/download`, {
        saveToDir: config.downloadsDir
      })),

    // ── Project Documents (Read-only) ──
    defTool('mis_list_documents', 'List all documents in a project (GET /api/v1/projects/{project_id}/documents/)', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/documents/`)),

    defTool('mis_get_document', 'Read document details. Use the project UUID for project documents and scope=course for LMS or Gallery documents.', {
      project_id: strProp('Project UUID, required for project documents', { minLength: 1 }),
      scope: strProp('Document scope (defaults to project)', { enum: ['project', 'course'] }),
      document_id: strProp('Document UUID', { minLength: 1 })
    }, ['document_id'], true, false,
      async args => {
        const did = assertSafeSegment(args.document_id, 'document_id');
        if (args.scope === 'course') {
          if (args.project_id) throw new MisApiError('INVALID_ARGUMENT', 'project_id is only for project documents', 400);
          return client.request('GET', `/api/v1/documents/${did}`);
        }
        if (!args.project_id) throw new MisApiError('MISSING_ARGUMENT', 'Missing required argument: project_id', 400);
        return client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/documents/${did}`);
      }),

    defTool('mis_download_project_document_file', 'Download a project document file into workspace downloads/ (GET /api/v1/project-documents/{document_id}/file)', {
      document_id: strProp('Document UUID', { minLength: 1 })
    }, ['document_id'], true, false,
      async args => await client.request('GET', `/api/v1/project-documents/${assertSafeSegment(args.document_id, 'document_id')}/file`, {
        saveToDir: config.downloadsDir
      })),

    // ── Courses, Groups, Assignments & Gallery (Read-only) ──
    defTool('mis_list_courses', 'List courses for current user (GET /api/v1/courses)', {
      semester: strProp('Optional semester filter', { minLength: 1 })
    }, [], true, false,
      async args => await client.request('GET', '/api/v1/courses', { query: { semester: args.semester } })),

    defTool('mis_get_course_students', 'List students in a course (GET /api/v1/courses/{course_id}/students)', {
      course_id: strProp('Course UUID', { minLength: 1 })
    }, ['course_id'], true, false,
      async args => await client.request('GET', `/api/v1/courses/${assertSafeSegment(args.course_id, 'course_id')}/students`)),

    defTool('mis_get_course_documents', 'List documents in a course (GET /api/v1/courses/{course_id}/documents)', {
      course_id: strProp('Course UUID', { minLength: 1 })
    }, ['course_id'], true, false,
      async args => await client.request('GET', `/api/v1/courses/${assertSafeSegment(args.course_id, 'course_id')}/documents`)),

    defTool('mis_get_course_groups', 'List student groups in a course (GET /api/v1/courses/{course_id}/groups)', {
      course_id: strProp('Course UUID', { minLength: 1 })
    }, ['course_id'], true, false,
      async args => await client.request('GET', `/api/v1/courses/${assertSafeSegment(args.course_id, 'course_id')}/groups`)),

    defTool('mis_get_course_assignments', 'List assignments in a course (GET /api/v1/courses/{course_id}/assignments)', {
      course_id: strProp('Course UUID', { minLength: 1 })
    }, ['course_id'], true, false,
      async args => await client.request('GET', `/api/v1/courses/${assertSafeSegment(args.course_id, 'course_id')}/assignments`)),

    defTool('mis_get_assignment', 'Get assignment details (GET /api/v1/assignments/{assignment_id})', {
      assignment_id: strProp('Assignment UUID', { minLength: 1 })
    }, ['assignment_id'], true, false,
      async args => await client.request('GET', `/api/v1/assignments/${assertSafeSegment(args.assignment_id, 'assignment_id')}`)),

    defTool('mis_list_gallery_videos', 'List public/course gallery videos with server pagination. Select pending for videos in the processing queue visible to this account.', {
      course_id: strProp('Optional course UUID', { minLength: 1 }),
      semester: strProp('Optional semester', { minLength: 1 }),
      search: strProp('Optional search query', { minLength: 1 }),
      filter: strProp('Optional filter', { minLength: 1 }),
      sort_by: strProp('Optional sort field', { minLength: 1 }),
      page: intProp('Page number (>=1)', { minimum: 1 }),
      page_size: intProp('Page size (1..100)', { minimum: 1, maximum: 100 }),
      pending: boolProp('List pending gallery videos')
    }, [], true, false,
      async ({ pending, ...query }) => await client.request('GET', pending ? '/api/v1/gallery/videos/pending' : '/api/v1/gallery/videos', { query })),

    defTool('mis_get_gallery_video', 'Get gallery video details by slug (GET /api/v1/gallery/videos/{slug})', {
      slug: strProp('Video slug', { minLength: 1 })
    }, ['slug'], true, false,
      async args => await client.request('GET', `/api/v1/gallery/videos/${assertSafeSegment(args.slug, 'slug')}`)),

    defTool('mis_list_gallery_documents', 'List course documents in gallery (GET /api/v1/gallery/documents)', {
      course_id: strProp('Optional course UUID', { minLength: 1 }),
      semester: strProp('Optional semester', { minLength: 1 }),
      search: strProp('Optional search query', { minLength: 1 }),
      page: intProp('Page number (>=1)', { minimum: 1 })
    }, [], true, false,
      async args => await client.request('GET', '/api/v1/gallery/documents', { query: args })),

    // ── Account-Scoped Full Data Collection & User Logs (Read-only) ──
    defTool('mis_collect_account_data', 'Collect full account-scoped data (profile, projects, members, tasks, checklists, comments, reports, documents, feed, performance, courses/assignments) via GET-only calls and save structured JSON snapshots inside exports/', {
      project_ids: strArrayProp('Optional array of project UUIDs to limit scope (omit to collect all accessible projects)'),
      include_courses: boolProp('Include accessible courses, groups, documents, assignments, and submissions (default true)'),
      include_task_details: boolProp('Fetch individual GET /tasks/{task_id} for each task in addition to list payload (default false)'),
      include_document_details: boolProp('Fetch full document details/AI summary for each project document (default true)'),
      include_ai_summary: boolProp('Include GET /projects/{id}/ai-summary per project (default false)'),
      include_gallery: boolProp('Include gallery videos and gallery documents pages (default false)'),
      max_gallery_pages: intProp('Max gallery pages when include_gallery=true (1..50, default 2)', { minimum: 1, maximum: 50 }),
      download_report_files: boolProp('Download attached task report proof/archive files into downloads/ (default false)'),
      download_document_files: boolProp('Download project document binary files into downloads/ (default false)'),
      output_dir: strProp('Optional relative or absolute output directory inside exports/', { minLength: 1 }),
      include_inline_summary_only: boolProp('Return manifest/stats/paths only to save context window (default true; set false to also inline full snapshot)')
    }, [], true, false,
      async args => await collectAccountData(client, config, args)),

    defTool('mis_get_user_logs', 'Find visible activity by date, participant and project (ai đã làm gì trong dự án). Default user is the current account. Use all_actors for a project timeline and compact for conversational results.', {
      user_id: strProp('Target user UUID (omit to use current user or email)', { minLength: 1 }),
      email: strProp('Target user email address (resolved via lookup/members)', { minLength: 3 }),
      project_id: strProp('Optional project UUID to restrict scan to one project', { minLength: 1 }),
      snapshot_path: strProp('Optional workspace path to full-snapshot.json or manifest.json for offline filtering', { minLength: 1 }),
      include_system_logs: boolProp('Include system audit/status events is_system_log=true (default true)'),
      include_feed_only_events: boolProp('Include deduplicated project feed events not present in task.comments (default true)'),
      types: strArrayProp('Optional filter array of types: comment, system_log, report, checklist, feed'),
      date_from: strProp('Inclusive start in +07:00 (YYYY-MM-DD) or ISO timestamp with timezone', { minLength: 4 }),
      date_to: strProp('Inclusive end in +07:00 (YYYY-MM-DD) or ISO timestamp with timezone', { minLength: 4 }),
      all_actors: boolProp('Include all visible actors. Requires project_id and no other user filter.'),
      compact: boolProp('Return short previews and omit geo/IP and user email from entries'),
      offset: intProp('Offset into the matching timeline', { minimum: 0 }),
      limit: intProp('Max log entries to return (1..5000, default 25 when compact=true, else 500)', { minimum: 1, maximum: 5000 }),
      save_to_file: boolProp('Save matched user timeline JSON into exports/ (default false)')
    }, [], true, false,
      async args => await queryUserLogs(client, config, args)),

    defTool('mis_query_my_tasks', 'Query tasks for daily check-in (hôm nay có việc gì), single day activity or weekly progress (tiến độ tuần này). Separate current task status, authored activity, scheduled deadlines, and logged review/DONE transitions (+07:00).', {
      user_id: strProp('Target user UUID (omit for current authenticated user)', { minLength: 1 }),
      email: strProp('Target user email address', { minLength: 3 }),
      project_id: strProp('Optional project UUID to restrict query to one project', { minLength: 1 }),
      date_vn: strProp('Optional Vietnam date YYYY-MM-DD (+07:00), or "today"/"yesterday", to inspect tasks with direct work/completion/deadline evidence on that date', { minLength: 5 }),
      date_from: strProp('Start of a period (YYYY-MM-DD +07:00 or ISO timestamp with timezone), instead of date_vn'),
      date_to: strProp('End of a period (YYYY-MM-DD +07:00 or ISO timestamp with timezone), instead of date_vn'),
      offset: intProp('Offset applied to each task bucket (counts cover all matches)', { minimum: 0 }),
      limit: intProp('Page size per task bucket (default 25)', { minimum: 1, maximum: 100 }),
      status: strProp('Optional status filter', { enum: ['TODO', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'MENTOR_REVIEW', 'DONE'] }),
      include_done: boolProp('Default false — keep false for check-ins and weekly progress (summary counts and periodAnalysis already include DONE tasks)'),
      include_claimable: boolProp('Include open claimable tasks not yet assigned to user (default true)'),
      snapshot_path: strProp('Optional workspace path to full-snapshot.json or manifest.json for offline queries', { minLength: 1 })
    }, [], true, false,
      async args => await queryMyTasks(client, config, args)),

    // ── Write / Action Tools (Project & Task Automation) ──
    defTool('mis_create_task', 'Create a new task in a project (POST /api/v1/projects/{project_id}/tasks/)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      title: strProp('Task title', { minLength: 1 }),
      description: strProp('Task description'),
      assignee_id: strProp('Single assignee UUID'),
      assignee_ids: strArrayProp('Array of assignee UUIDs'),
      deadline: strProp('ISO 8601 deadline string'),
      parent_id: strProp('Parent task UUID'),
      estimated_hours: numProp('Estimated hours'),
      is_claimable: boolProp('Whether task is open to claim')
    }, ['project_id', 'title'], false, false, async args => {
      const { project_id, ...body } = args;
      return await client.request('POST', `/api/v1/projects/${assertSafeSegment(project_id, 'project_id')}/tasks/`, { json: body });
    }),

    defTool('mis_update_task', 'Update a task status, fields, assignees, deadline, or hours (PATCH /api/v1/projects/{project_id}/tasks/{task_id})', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      title: strProp('New title'),
      description: strProp('New description'),
      status: strProp('New status', { enum: ['TODO', 'IN_PROGRESS', 'INTERNAL_REVIEW', 'MENTOR_REVIEW', 'DONE'] }),
      assignee_id: strProp('Primary assignee UUID'),
      assignee_ids: strArrayProp('Array of assignee UUIDs'),
      deadline: strProp('ISO 8601 deadline string'),
      parent_id: strProp('Parent task UUID'),
      estimated_hours: numProp('Estimated hours'),
      actual_hours: numProp('Actual hours'),
      is_claimable: boolProp('Whether task is open to claim')
    }, ['project_id', 'task_id'], false, false, async args => {
      const { project_id, task_id, ...body } = args;
      return await client.request('PATCH', `/api/v1/projects/${assertSafeSegment(project_id, 'project_id')}/tasks/${assertSafeSegment(task_id, 'task_id')}`, { json: body });
    }),

    defTool('mis_delete_task', 'Soft-delete a task (DELETE /api/v1/projects/{project_id}/tasks/{task_id})', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 })
    }, ['project_id', 'task_id'], false, true,
      async args => await client.request('DELETE', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/${assertSafeSegment(args.task_id, 'task_id')}`)),

    defTool('mis_claim_task', 'Claim an open task for the authenticated user (POST /api/v1/projects/{project_id}/tasks/{task_id}/claim)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 })
    }, ['project_id', 'task_id'], false, false,
      async args => await client.request('POST', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/tasks/${assertSafeSegment(args.task_id, 'task_id')}/claim`)),

    defTool('mis_release_task', 'Release an assigned task back to open pool (POST /api/v1/projects/{project_id}/tasks/{task_id}/release)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      reason: strProp('Optional release reason')
    }, ['project_id', 'task_id'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/release`, {
        json: args.reason !== undefined ? { reason: args.reason } : null
      });
    }),

    defTool('mis_add_checklist', 'Add a checklist item to a task (POST .../checklists)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      title: strProp('Checklist item title', { minLength: 1 }),
      estimated_hours: numProp('Optional estimated hours')
    }, ['project_id', 'task_id', 'title'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/checklists`, {
        json: { title: args.title, ...(args.estimated_hours !== undefined ? { estimated_hours: args.estimated_hours } : {}) }
      });
    }),

    defTool('mis_toggle_checklist', 'Toggle a checklist item completion and optionally record actual_hours (PATCH .../checklists/{checklist_id})', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      checklist_id: strProp('Checklist item UUID', { minLength: 1 }),
      is_completed: boolProp('Completion state'),
      actual_hours: numProp('Optional actual hours spent')
    }, ['project_id', 'task_id', 'checklist_id', 'is_completed'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      const cid = assertSafeSegment(args.checklist_id, 'checklist_id');
      return await client.request('PATCH', `/api/v1/projects/${pid}/tasks/${tid}/checklists/${cid}`, {
        json: { is_completed: args.is_completed, ...(args.actual_hours !== undefined ? { actual_hours: args.actual_hours } : {}) }
      });
    }),

    defTool('mis_rename_checklist', 'Rename a checklist item (PATCH .../checklists/{checklist_id}/title)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      checklist_id: strProp('Checklist item UUID', { minLength: 1 }),
      title: strProp('New checklist title', { minLength: 1 })
    }, ['project_id', 'task_id', 'checklist_id', 'title'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      const cid = assertSafeSegment(args.checklist_id, 'checklist_id');
      return await client.request('PATCH', `/api/v1/projects/${pid}/tasks/${tid}/checklists/${cid}/title`, {
        json: { title: args.title }
      });
    }),

    defTool('mis_delete_checklist', 'Delete a checklist item (DELETE .../checklists/{checklist_id})', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      checklist_id: strProp('Checklist item UUID', { minLength: 1 })
    }, ['project_id', 'task_id', 'checklist_id'], false, true, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      const cid = assertSafeSegment(args.checklist_id, 'checklist_id');
      return await client.request('DELETE', `/api/v1/projects/${pid}/tasks/${tid}/checklists/${cid}`);
    }),

    defTool('mis_generate_checklist_ai', 'Generate AI checklist suggestions for a task (POST .../generate-checklist)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 })
    }, ['project_id', 'task_id'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/generate-checklist`);
    }),

    defTool('mis_submit_task_report', 'Submit a task report with text, optional link, and optional local file (auto-chunks >5MB)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      report_text: strProp('Report text summary'),
      report_link_url: strProp('External proof link (e.g. Google Docs / Figma)'),
      file_path: strProp('Optional local file path to attach as proof/log')
    }, ['project_id', 'task_id'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      if (!args.report_text && !args.report_link_url && !args.file_path) {
        throw new MisApiError('INVALID_ARGUMENT', 'Provide at least one of report_text, report_link_url, or file_path', 400);
      }

      if (args.file_path) {
        if (!fs.existsSync(args.file_path)) {
          throw new MisApiError('FILE_NOT_FOUND', `Local file not found: ${args.file_path}`, 400);
        }
        const buf = fs.readFileSync(args.file_path);
        const fileName = path.basename(args.file_path);
        if (buf.length > CHUNK_SIZE) {
          const totalChunks = Math.ceil(buf.length / CHUNK_SIZE);
          const uploadId = crypto.randomUUID();
          let lastResp = null;
          for (let i = 0; i < totalChunks; i++) {
            const slice = buf.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, buf.length));
            const fd = new FormData();
            fd.append('upload_id', uploadId);
            fd.append('chunk_index', String(i));
            fd.append('total_chunks', String(totalChunks));
            fd.append('file', new Blob([slice]), fileName);
            fd.append('original_filename', fileName);
            if (args.report_text) fd.append('report_text', args.report_text);
            if (args.report_link_url) fd.append('report_link_url', args.report_link_url);
            lastResp = await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/upload-report-chunked`, {
              formData: fd,
              timeoutMs: 60000
            });
          }
          return lastResp;
        }
        const fd = new FormData();
        if (args.report_text) fd.append('report_text', args.report_text);
        if (args.report_link_url) fd.append('report_link_url', args.report_link_url);
        fd.append('file', new Blob([buf]), fileName);
        return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/reports`, { formData: fd, timeoutMs: 60000 });
      }

      const fd = new FormData();
      if (args.report_text) fd.append('report_text', args.report_text);
      if (args.report_link_url) fd.append('report_link_url', args.report_link_url);
      return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/reports`, { formData: fd });
    }),

    defTool('mis_add_task_comment', 'Post a comment on a task (POST .../tasks/{task_id}/comments)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      task_id: strProp('Task UUID', { minLength: 1 }),
      content: strProp('Comment text', { minLength: 1 })
    }, ['project_id', 'task_id', 'content'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const tid = assertSafeSegment(args.task_id, 'task_id');
      return await client.request('POST', `/api/v1/projects/${pid}/tasks/${tid}/comments`, { json: { content: args.content } });
    }),

    defTool('mis_add_project_comment', 'Post a general comment in the project feed (POST .../projects/{project_id}/comments)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      content: strProp('Comment text', { minLength: 1 })
    }, ['project_id', 'content'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      return await client.request('POST', `/api/v1/projects/${pid}/comments`, { json: { content: args.content } });
    }),

    defTool('mis_create_document', 'Create a text or file document in a project (POST .../documents/ or .../documents/upload)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      title: strProp('Document title', { minLength: 1 }),
      content: strProp('Optional markdown/text content'),
      file_path: strProp('Optional local file path to upload')
    }, ['project_id', 'title'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      if (args.file_path) {
        if (!fs.existsSync(args.file_path)) {
          throw new MisApiError('FILE_NOT_FOUND', `Local file not found: ${args.file_path}`, 400);
        }
        const buf = fs.readFileSync(args.file_path);
        const fileName = path.basename(args.file_path);
        const fd = new FormData();
        fd.append('title', args.title);
        if (args.content) fd.append('content', args.content);
        fd.append('file', new Blob([buf]), fileName);
        return await client.request('POST', `/api/v1/projects/${pid}/documents/upload`, { formData: fd, timeoutMs: 60000 });
      }
      return await client.request('POST', `/api/v1/projects/${pid}/documents/`, {
        json: { title: args.title, content: args.content ?? null }
      });
    }),

    defTool('mis_create_task_from_doc', 'Create a task linked to a project document (POST .../documents/{document_id}/create-task)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      document_id: strProp('Document UUID', { minLength: 1 }),
      title: strProp('Task title', { minLength: 1 }),
      description: strProp('Task description'),
      assignee_id: strProp('Single assignee UUID'),
      assignee_ids: strArrayProp('Array of assignee UUIDs'),
      deadline: strProp('Deadline string')
    }, ['project_id', 'document_id', 'title'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const did = assertSafeSegment(args.document_id, 'document_id');
      const { project_id, document_id, ...body } = args;
      return await client.request('POST', `/api/v1/projects/${pid}/documents/${did}/create-task`, { json: body });
    }),

    defTool('mis_ai_summarize_project', 'Get AI summary of a project (GET /api/v1/projects/{project_id}/ai-summary)', {
      project_id: strProp('Project UUID', { minLength: 1 })
    }, ['project_id'], true, false,
      async args => await client.request('GET', `/api/v1/projects/${assertSafeSegment(args.project_id, 'project_id')}/ai-summary`, { timeoutMs: 45000 })),

    defTool('mis_ai_explain_text', 'Ask AI to explain highlighted text or task context (POST .../documents/{document_id}/explain)', {
      project_id: strProp('Project UUID', { minLength: 1 }),
      document_id: strProp('Document UUID or "task-context"', { minLength: 1 }),
      highlighted_text: strProp('Question or highlighted text', { minLength: 1 }),
      context_window: strProp('Optional surrounding context (<=4000 chars)')
    }, ['project_id', 'document_id', 'highlighted_text'], false, false, async args => {
      const pid = assertSafeSegment(args.project_id, 'project_id');
      const did = assertSafeSegment(args.document_id, 'document_id');
      return await client.request('POST', `/api/v1/projects/${pid}/documents/${did}/explain`, {
        json: { highlighted_text: args.highlighted_text, context_window: args.context_window ?? null },
        timeoutMs: 45000
      });
    }),

    defTool('mis_ai_suggest_task', 'Generate AI task breakdown from an idea (POST /api/v1/ai/suggest-task)', {
      idea: strProp('Task idea or prompt', { minLength: 1 })
    }, ['idea'], false, false,
      async args => await client.request('POST', '/api/v1/ai/suggest-task', { json: { idea: args.idea }, timeoutMs: 45000 })),

    defTool('mis_raw_api', 'Call any Matrix AI EDU /api/v1/... endpoint directly with Bearer auth (respects MIS_READ_ONLY)', {
      method: strProp('HTTP method', { enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] }),
      path: strProp('API path starting with /api/v1/', { minLength: 8 }),
      query: { type: 'object', description: 'Optional query parameters object' },
      body: { type: 'object', description: 'Optional JSON request body object' }
    }, ['method', 'path'], false, true, async args => {
      return await client.request(args.method, args.path, {
        query: args.query,
        json: args.body
      });
    })
  ];

  const byName = new Map(list.map(t => [t.name, t]));
  const tools = list.map(({ handler, ...meta }) => meta);

  async function invoke(name, args = {}) {
    const tool = byName.get(name);
    if (!tool) {
      throw new MisApiError('UNKNOWN_TOOL', `Unknown tool: ${name}`, 404);
    }
    validateArgs(tool, args);
    return await tool.handler(args);
  }

  return { tools, invoke };
}

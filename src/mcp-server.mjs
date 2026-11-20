#!/usr/bin/env node
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { MisClient, MisApiError } from './client.mjs';
import { AuthSessionManager } from './auth-manager.mjs';
import { createToolRegistry } from './tools.mjs';

export function createMcpServer(options = {}) {
  const config = options.config || loadConfig(options.env);
  const authManager = options.authManager !== undefined
    ? options.authManager
    : new AuthSessionManager(config, { fetchImpl: options.fetchImpl, ...(options.deps || {}) });
  const client = options.client || new MisClient(config, options.fetchImpl, { authManager });
  const registry = createToolRegistry(client, config, options.deps);

  async function dispatch(request) {
    if (!request || typeof request !== 'object') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    if (request.id === undefined || request.id === null) {
      return null;
    }

    try {
      if (request.method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mis_matrix', version: '1.0.0' },
            instructions: [
              'Handle Vietnamese MIS questions directly without asking for a tool name.',
              'For daily task check-ins use mis_query_my_tasks with date_vn in Asia/Saigon (supports YYYY-MM-DD or "today"/"yesterday"). For weekly progress supply date_from and date_to. Keep include_done omitted/false on mis_query_my_tasks for daily check-ins and weekly progress (summary counts and periodAnalysis already cover DONE tasks).',
              'Resolve project names with mis_list_projects and task titles with mis_list_tasks using compact=true and search. For project activity use mis_get_user_logs with project_id, compact=true, all_actors=true and limit=25 unless the user asked about one person.',
              'For one named task, call mis_get_task directly with project_name and task_title, or use known IDs. For checklist, comments and reports use view=summary and quote comment_counts.total, manual and system_log from the raw task. Grouped items are examples, never counts. Use view=review for who moved a task into review and when, and follow next_offset when more results are needed. Use view=history for other status and assignment events. These views include actor names and timestamps. Request view=full only for verbatim content.',
              'Use mis_get_project_performance for KPI and backend-reported milestones. A deadline is a schedule, and comment/report timestamps only establish those events. Use explicit status transitions for DONE history and explain coverage limits. Answer directly from compact MCP outputs without writing scratch scripts when data is already present.'
            ].join(' ')
          }
        };
      }
      if (request.method === 'ping') {
        return { jsonrpc: '2.0', id: request.id, result: {} };
      }
      if (request.method === 'tools/list') {
        return { jsonrpc: '2.0', id: request.id, result: { tools: registry.tools } };
      }
      if (request.method === 'tools/call') {
        const name = request.params?.name;
        const args = request.params?.arguments || {};
        try {
          const data = await registry.invoke(name, args);
          const payload = { ok: true, tool: name, data };
          const compactText = JSON.stringify(payload);
          const text = name === 'mis_get_task' || compactText.length <= 14000 ? compactText : JSON.stringify(payload, null, 2);
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text }],
              structuredContent: payload,
              isError: false
            }
          };
        } catch (err) {
          const payload = {
            ok: false,
            tool: name,
            error: {
              code: err instanceof MisApiError ? err.code : 'INTERNAL_ERROR',
              status: err instanceof MisApiError ? err.status : 500,
              message: err.message,
              details: err instanceof MisApiError ? err.details : null
            }
          };
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
              structuredContent: payload,
              isError: true
            }
          };
        }
      }
      return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    } catch (err) {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: err.message } };
    }
  }

  return { config, client, registry, dispatch };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createMcpServer();
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const res = await server.dispatch(req);
    if (res) {
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  });
}

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

function coerceCliVal(rawVal, schema = {}) {
  const t = schema?.type;
  if (t === 'boolean') {
    const low = String(rawVal || '').trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(low)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(low)) return false;
    throw new Error(`Invalid boolean value: ${rawVal}`);
  }
  if (t === 'integer') {
    const parsed = Number.parseInt(String(rawVal), 10);
    if (!Number.isInteger(parsed)) throw new Error(`Invalid integer value: ${rawVal}`);
    return parsed;
  }
  if (t === 'number') {
    const parsed = Number(rawVal);
    if (Number.isNaN(parsed)) throw new Error(`Invalid number value: ${rawVal}`);
    return parsed;
  }
  if (t === 'array') {
    const trimmed = String(rawVal || '').trim();
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) throw new Error(`Expected JSON array: ${rawVal}`);
      return parsed.map(x => String(x));
    }
    return trimmed ? trimmed.split(',').map(s => s.trim()).filter(Boolean) : [];
  }
  if (t === 'object') {
    const parsed = JSON.parse(String(rawVal));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Expected JSON object: ${rawVal}`);
    }
    return parsed;
  }
  return String(rawVal);
}

export async function runCli(argv = [], options = {}) {
  const server = options.server || createMcpServer(options);
  const { registry } = server;
  const toolMap = new Map(registry.tools.map(t => [t.name, t]));
  const writeStream = options.stdout || process.stdout;
  const errStream = options.stderr || process.stderr;

  const args = [...argv];
  if (args[0] === '--call') args.shift();

  if (args.length === 0 || ['-h', '--help', 'help'].includes(args[0])) {
    writeStream.write(
      JSON.stringify(
        {
          usage: 'node src/mcp-server.mjs <tool_name> [--param value ... | --args \'<json>\']',
          available_tools: registry.tools.map(t => t.name)
        },
        null,
        2
      ) + '\n'
    );
    return 0;
  }

  const toolName = String(args.shift() || '').trim();
  const toolMeta = toolMap.get(toolName);
  if (!toolMeta) {
    errStream.write(`Unknown tool ${JSON.stringify(toolName)}. Available: ${registry.tools.map(t => t.name).join(', ')}\n`);
    return 2;
  }

  const props = toolMeta.inputSchema?.properties || {};
  const kwargs = {};
  let i = 0;
  while (i < args.length) {
    const tok = String(args[i]);
    if (tok === '--args') {
      if (i + 1 >= args.length) {
        errStream.write('--args requires a JSON object string\n');
        return 2;
      }
      let parsed;
      try {
        parsed = JSON.parse(args[i + 1]);
      } catch (err) {
        errStream.write(`Invalid JSON for --args: ${err.message}\n`);
        return 2;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errStream.write('--args must decode to a JSON object\n');
        return 2;
      }
      Object.assign(kwargs, parsed);
      i += 2;
      continue;
    }
    if (tok.startsWith('--')) {
      const keyRaw = tok.slice(2);
      if (keyRaw.includes('=')) {
        const eqIdx = keyRaw.indexOf('=');
        const kPart = keyRaw.slice(0, eqIdx);
        const vPart = keyRaw.slice(eqIdx + 1);
        const normKey = kPart.replace(/-/g, '_');
        const schema = props[normKey];
        if (!schema) {
          errStream.write(`Unknown parameter ${JSON.stringify(kPart)} for ${toolName}\n`);
          return 2;
        }
        try {
          kwargs[normKey] = coerceCliVal(vPart, schema);
        } catch (err) {
          errStream.write(`${err.message}\n`);
          return 2;
        }
        i += 1;
        continue;
      }
      const normKey = keyRaw.replace(/-/g, '_');
      const schema = props[normKey];
      if (!schema) {
        errStream.write(`Unknown parameter ${JSON.stringify(keyRaw)} for ${toolName}\n`);
        return 2;
      }
      if (schema.type === 'boolean' && (i + 1 >= args.length || String(args[i + 1]).startsWith('--'))) {
        kwargs[normKey] = true;
        i += 1;
        continue;
      }
      if (i + 1 >= args.length) {
        errStream.write(`Missing value for ${tok}\n`);
        return 2;
      }
      try {
        kwargs[normKey] = coerceCliVal(args[i + 1], schema);
      } catch (err) {
        errStream.write(`${err.message}\n`);
        return 2;
      }
      i += 2;
      continue;
    }
    if (tok.startsWith('{') && tok.endsWith('}')) {
      let parsed;
      try {
        parsed = JSON.parse(tok);
      } catch (err) {
        errStream.write(`Invalid positional JSON: ${err.message}\n`);
        return 2;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errStream.write('Positional JSON argument must decode to an object\n');
        return 2;
      }
      Object.assign(kwargs, parsed);
      i += 1;
      continue;
    }
    errStream.write(`Unexpected argument: ${JSON.stringify(tok)}\n`);
    return 2;
  }

  try {
    const result = await registry.invoke(toolName, kwargs);
    writeStream.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (err) {
    const payload = {
      ok: false,
      tool: toolName,
      error: {
        code: err instanceof MisApiError ? err.code : 'INTERNAL_ERROR',
        status: err instanceof MisApiError ? err.status : 500,
        message: err.message,
        details: err instanceof MisApiError ? err.details : null
      }
    };
    errStream.write(JSON.stringify(payload, null, 2) + '\n');
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length > 2) {
    const code = await runCli(process.argv.slice(2));
    process.exit(code);
  }
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

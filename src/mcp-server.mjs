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
            serverInfo: { name: 'mis_matrix', version: '1.0.0' }
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
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
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

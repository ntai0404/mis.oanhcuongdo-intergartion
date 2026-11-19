import fs from 'node:fs';
import path from 'node:path';

export class MisApiError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message);
    this.name = 'MisApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assertSafeSegment(value, label = 'id') {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MisApiError('INVALID_ARGUMENT', `${label} is required`, 400);
  }
  if (/[\/\\\0?#]/.test(value) || value === '.' || value === '..' || value.includes('..')) {
    throw new MisApiError('INVALID_ARGUMENT', `${label} contains disallowed path characters`, 400);
  }
  return encodeURIComponent(value.trim());
}

export function assertSafeApiPath(apiPath) {
  if (typeof apiPath !== 'string' || !apiPath.startsWith('/api/v1/')) {
    throw new MisApiError('INVALID_PATH', 'Path must start with /api/v1/', 400);
  }
  if (apiPath.includes('..') || apiPath.includes('\\') || /[\r\n\0]/.test(apiPath)) {
    throw new MisApiError('INVALID_PATH', 'Path contains disallowed traversal or control characters', 400);
  }
  return apiPath;
}

export class MisClient {
  constructor(config, fetchImpl = globalThis.fetch, options = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.authManager = options.authManager || null;
  }

  setToken(token) {
    this.config.token = token;
  }

  async request(method, apiPath, options = {}) {
    const upperMethod = String(method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(upperMethod)) {
      throw new MisApiError('INVALID_METHOD', `Unsupported HTTP method: ${upperMethod}`, 400);
    }
    if (this.config.readOnly && upperMethod !== 'GET') {
      throw new MisApiError('READ_ONLY_MODE', `Blocked ${upperMethod} ${apiPath} because MIS_READ_ONLY is enabled`, 403);
    }

    const cleanPath = assertSafeApiPath(apiPath);
    const url = new URL(cleanPath, this.config.baseUrl);
    if (options.query && typeof options.query === 'object') {
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const headers = new Headers(options.headers || {});
    if (!options.skipAuth) {
      if (!this.config.token && this.authManager && !options._retriedAuth) {
        await this.authManager.trySilentRecover('', 'MISSING_TOKEN');
      }
      if (!this.config.token) {
        throw new MisApiError('AUTH_REQUIRED', 'MIS_BEARER_TOKEN is missing; configure .env.mis or run node setup.mjs / mis_refresh_token_from_cdp', 401);
      }
      if (this.authManager && !options._retriedAuth && this.authManager.needsPreemptiveRefresh(this.config.token)) {
        const rec = await this.authManager.trySilentRecover(this.config.token, 'PREEMPTIVE_EXPIRED');
        if (!rec.recovered) {
          throw this.authManager.buildExpiredError(rec);
        }
      }
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }

    let body;
    if (options.formData) {
      body = options.formData;
    } else if (options.json !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.json);
    }

    const timeoutMs = options.timeoutMs || this.config.timeoutMs || 20000;
    let res;
    try {
      res = await this.fetchImpl(url.href, {
        method: upperMethod,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'manual'
      });
    } catch (err) {
      throw new MisApiError('NETWORK_ERROR', `Request failed (${upperMethod} ${cleanPath}): ${err.message}`, 502);
    }

    if (res.status === 401 && !options.skipAuth && !options._retriedAuth && this.authManager) {
      const rec = await this.authManager.trySilentRecover(this.config.token, 'HTTP_401');
      if (rec.recovered) {
        return await this.request(method, apiPath, { ...options, _retriedAuth: true });
      }
      throw this.authManager.buildExpiredError(rec);
    }

    if (res.status >= 300 && res.status < 400) {
      throw new MisApiError('REDIRECT_BLOCKED', `Unexpected redirect (${res.status}) on ${cleanPath}; check authentication`, res.status, {
        location: res.headers.get('location') || null
      });
    }

    const contentType = res.headers.get('content-type') || '';

    if (options.saveToDir && res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const disp = res.headers.get('content-disposition') || '';
      const utf8Match = disp.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiMatch = disp.match(/filename="?([^";]+)"?/i);
      const rawName = options.fallbackFilename || (utf8Match ? decodeURIComponent(utf8Match[1]) : asciiMatch?.[1]) || 'download.bin';
      const safeName = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'download.bin';
      fs.mkdirSync(options.saveToDir, { recursive: true });
      const targetFile = path.join(options.saveToDir, `${Date.now()}-${safeName}`);
      fs.writeFileSync(targetFile, buf);
      return {
        status: res.status,
        contentType,
        bytes: buf.length,
        savedPath: targetFile,
        filename: safeName
      };
    }

    const text = await res.text();
    let data = text;
    if (contentType.includes('application/json')) {
      try {
        data = JSON.parse(text);
      } catch {
        // keep text
      }
    } else if (text.length > 16000) {
      data = text.slice(0, 16000) + '\n...[truncated]';
    }

    if (!res.ok) {
      const detail = typeof data === 'object' && data !== null ? (data.detail || JSON.stringify(data)) : String(data).slice(0, 400);
      throw new MisApiError('HTTP_' + res.status, `API ${upperMethod} ${cleanPath} returned ${res.status}: ${detail}`, res.status, data);
    }

    return data;
  }
}

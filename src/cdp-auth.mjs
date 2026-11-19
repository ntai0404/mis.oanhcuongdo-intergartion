import { MisApiError } from './client.mjs';

export function validateLoopbackEndpoint(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new MisApiError('INVALID_CDP_ENDPOINT', 'CDP endpoint must be a valid http://127.0.0.1:<port> URL', 400);
  }
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !u.port) {
    throw new MisApiError('INVALID_CDP_ENDPOINT', 'CDP endpoint must be loopback HTTP with explicit port', 400);
  }
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
  return u.origin;
}

export async function extractAccessTokenFromCdp(cdpEndpoint, targetUrl = 'https://mis.oanhcuongdo.com/', timeoutMs = 10000) {
  const origin = validateLoopbackEndpoint(cdpEndpoint);
  const verRes = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!verRes.ok) {
    throw new MisApiError('CDP_CONNECTION_FAILED', `CDP /json/version returned ${verRes.status}`, 502);
  }
  const ver = await verRes.json();
  if (!ver.webSocketDebuggerUrl) {
    throw new MisApiError('CDP_CONNECTION_FAILED', 'CDP webSocketDebuggerUrl missing', 502);
  }

  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new MisApiError('CDP_TIMEOUT', 'Timed out connecting to CDP WebSocket', 504));
    }, timeoutMs);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new MisApiError('CDP_CONNECTION_FAILED', 'CDP WebSocket error', 502)); }, { once: true });
  });

  let nextId = 0;
  const callCdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new MisApiError('CDP_TIMEOUT', `CDP ${method} timed out`, 504)), timeoutMs);
    const onMessage = event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (msg.error) reject(new MisApiError('CDP_ERROR', msg.error.message, 502));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });

  try {
    const targets = await callCdp('Target.getTargets');
    const page = (targets.targetInfos || []).find(t => t.type === 'page' && t.url.startsWith('https://mis.oanhcuongdo.com')) || (targets.targetInfos || []).find(t => t.type === 'page');
    if (!page) {
      throw new MisApiError('CDP_NO_TARGET', 'No open browser page target found on CDP endpoint', 404);
    }
    const { sessionId } = await callCdp('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    try {
      const id = ++nextId;
      const cookieRes = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new MisApiError('CDP_TIMEOUT', 'Network.getCookies timed out', 504)), timeoutMs);
        const onMessage = event => {
          let msg;
          try { msg = JSON.parse(event.data); } catch { return; }
          if (msg.id !== id) return;
          ws.removeEventListener('message', onMessage);
          clearTimeout(timer);
          if (msg.error) reject(new MisApiError('CDP_ERROR', msg.error.message, 502));
          else resolve(msg.result);
        };
        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify({ id, method: 'Network.getCookies', params: { urls: [targetUrl] }, sessionId }));
      });
      const cookie = (cookieRes.cookies || []).find(c => c.name === 'access_token');
      if (!cookie?.value) {
        throw new MisApiError('TOKEN_NOT_FOUND', 'access_token cookie not found in browser session; log into mis.oanhcuongdo.com first', 401);
      }
      return {
        token: cookie.value,
        expires: cookie.expires || null,
        domain: cookie.domain
      };
    } finally {
      try { await callCdp('Target.detachFromTarget', { sessionId }); } catch {}
    }
  } finally {
    try { ws.close(); } catch {}
  }
}

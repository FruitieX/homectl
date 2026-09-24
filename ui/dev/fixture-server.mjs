#!/usr/bin/env node
/**
 * Development API server for the Settings UX work.
 *
 *   node dev/fixture-server.mjs [--fixture normal] [--port 45901]
 *   HOMECTL_DEV_PROXY_TARGET=http://127.0.0.1:45901 pnpm dev   # vite on :3000
 *
 * Serves the fixture sets from `fixtures.mjs` with the same endpoints and
 * response envelope as the real server, keeps mutations in memory, and logs
 * every request so missing endpoints are easy to spot. Switch fixtures at
 * runtime with `curl -X POST http://127.0.0.1:45901/__fixture/large`.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import { fixtures } from './fixtures.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const port = Number(process.env.PORT ?? args.get('port') ?? 45901);
const initial = process.env.FIXTURE ?? args.get('fixture') ?? 'normal';

if (!fixtures[initial]) {
  console.error(`unknown fixture '${initial}'; expected one of ${Object.keys(fixtures).join(', ')}`);
  process.exit(1);
}

let name = initial;
let db = fixtures[initial]();

function reload(nextName) {
  if (!fixtures[nextName]) return false;
  name = nextName;
  db = fixtures[nextName]();
  return true;
}

const writeOk = { applied: true, persistence: { kind: 'persisted' }, warning: null };

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  if (status >= 400) {
    console.log(`  <- ${status} ${payload.slice(0, 160)}`);
  }
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ __unparsed: raw });
      }
    });
  });
}

/** config endpoint name -> array in db.config (or a special key) */
const SPECIAL_GET = {
  'runtime-status': () => db.runtimeStatus,
  'routine-history': () => db.routineHistory,
  logs: () => db.logs,
  'config-export': () => ({ version: 1, exported_at: new Date().toISOString() }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') return send(res, 204);

  if (path === '/__fixture') {
    const next = url.searchParams.get('name') ?? (await readBody(req))?.name;
    if (next && reload(next)) {
      console.log(`fixture switched to '${next}'`);
      return send(res, 200, { success: true, fixture: name });
    }
    return send(res, 400, { success: false, error: `unknown fixture '${next}'`, fixtures: Object.keys(fixtures) });
  }
  if (path.startsWith('/__fixture/')) {
    const next = decodeURIComponent(path.slice('/__fixture/'.length));
    if (reload(next)) {
      console.log(`fixture switched to '${next}'`);
      return send(res, 200, { success: true, fixture: name });
    }
    return send(res, 404, { success: false, error: `unknown fixture '${next}'` });
  }

  console.log(`${method} ${req.url}`);

  if (path === '/api/config') return send(res, 200, {});
  if (path === '/health/live' || path === '/health/ready') return send(res, 200, { status: 'ok' });
  if (path === '/api/v1/commands/scene') {
    const body = await readBody(req);
    console.log(`  -> scene command: ${JSON.stringify(body)}`);
    // Same shape the real command endpoint answers with.
    return send(res, 200, { applied: true, scene_id: body?.scene_id ?? null });
  }

  if (path === '/api/v1/devices' && method === 'GET') {
    return send(res, 200, { devices: db.devices });
  }
  if (path.startsWith('/api/v1/devices/') && method === 'PUT') {
    const id = decodeURIComponent(path.slice('/api/v1/devices/'.length));
    const body = await readBody(req);
    const idx = db.devices.findIndex((d) => d.id === id);
    if (idx >= 0) db.devices[idx] = { ...db.devices[idx], ...body };
    return send(res, 200, { success: true, data: db.devices[idx], write: writeOk });
  }

  const configMatch = /^\/api\/v1\/config\/([a-z0-9-]+)(?:\/(.*))?$/.exec(path);
  if (configMatch) {
    const endpoint = configMatch[1];
    const rest = configMatch[2] ? decodeURIComponent(configMatch[2]) : null;

    const failure = db.failures?.[`config/${endpoint}`];
    if (failure && method === 'GET') {
      return send(res, failure, { success: false, error: `${endpoint} is unavailable (simulated ${failure})` });
    }
    if (db.lagMs && method === 'GET') await sleep(db.lagMs);

    if (method === 'GET') {
      if (rest) {
        // Single item GETs are used by detail pages; fall back to the list.
        const list = Array.isArray(db.config[endpoint]) ? db.config[endpoint] : [];
        const item = list.find((i) => i.id === rest || i.device_key === rest);
        if (item) return send(res, 200, { success: true, data: item });
        console.log(`  !! no fixture item for config/${endpoint}/${rest}`);
        return send(res, 404, { success: false, error: 'not found' });
      }
      const special = SPECIAL_GET[endpoint];
      if (special) return send(res, 200, { success: true, data: special() });
      const list = Array.isArray(db.config[endpoint]) ? db.config[endpoint] : [];
      return send(res, 200, { success: true, data: list });
    }

    if (method === 'POST' && rest === 'preview') {
      const body = await readBody(req);
      if (endpoint === 'routines') {
        return send(res, 200, {
          success: true,
          data: { will_trigger: true, assumed_trigger: body?.trigger_id ?? 't1', first_blocking_reason: null, steps: [], condition: { truth: 'true', trace: { kind: 'all', children: [] } } },
        });
      }
      return send(res, 200, { success: true, data: { samples: [], summary: 'fixture preview' } });
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint]) ? db.config[endpoint] : (db.config[endpoint] = []);
      if (endpoint === 'migrate' || endpoint === 'import') return send(res, 200, { success: true, data: { applied: true } });
      const item = { ...body };
      const idx = list.findIndex((i) => i.id === item.id);
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      return send(res, 200, { success: true, data: item, write: writeOk });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint]) ? db.config[endpoint] : (db.config[endpoint] = []);
      if (endpoint === 'core' || endpoint === 'assistant') {
        return send(res, 200, { success: true, data: body, write: writeOk });
      }
      const id = rest ?? body?.id ?? body?.device_key;
      const idx = list.findIndex((i) => i.id === id || i.device_key === id);
      const item = { ...(idx >= 0 ? list[idx] : {}), ...body, id: id ?? body?.id };
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      return send(res, 200, { success: true, data: item, write: writeOk });
    }

    if (method === 'DELETE') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint]) ? db.config[endpoint] : [];
      const id = rest ?? body?.id ?? body?.device_key;
      const idx = list.findIndex((i) => i.id === id || i.device_key === id);
      if (idx >= 0) list.splice(idx, 1);
      return send(res, 200, { success: true, data: { id }, write: writeOk });
    }
  }

  if (path === '/api/v1/config/floorplan/grid' || path === '/api/v1/config/floorplan/image') {
    return send(res, 200, { success: true, data: {}, write: writeOk });
  }

  if (path.startsWith('/api/v1/config/assistant')) {
    return send(res, 200, { success: true, data: { threads: [], plans: [], actions: [] } });
  }
  if (path.startsWith('/api/v1/config/calibration')) {
    return send(res, 200, { success: true, data: [], write: writeOk });
  }

  console.warn(`  !! unhandled ${method} ${path}`);
  return send(res, 200, { success: true, data: [] });
});

/**
 * Accept the live-state WebSocket upgrade so the UI does not reconnect in a
 * loop. Fixtures have no live state, so the socket stays open and silent
 * instead of pushing frames it does not have.
 */
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'),
  );
  socket.on('error', () => socket.destroy());
});

server.listen(port, '0.0.0.0', () => {
  console.log(`fixture server on http://127.0.0.1:${port} (fixture '${name}')`);
  console.log(`point the dev server at it: HOMECTL_DEV_PROXY_TARGET=http://127.0.0.1:${port} pnpm dev`);
});

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
  console.error(
    `unknown fixture '${initial}'; expected one of ${Object.keys(fixtures).join(', ')}`,
  );
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

const writeOk = {
  applied: true,
  persistence: { kind: 'persisted' },
  warning: null,
};

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
  'config-export': () => ({
    version: 1,
    exported_at: new Date().toISOString(),
  }),
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
    return send(res, 400, {
      success: false,
      error: `unknown fixture '${next}'`,
      fixtures: Object.keys(fixtures),
    });
  }
  if (path.startsWith('/__fixture/')) {
    const next = decodeURIComponent(path.slice('/__fixture/'.length));
    if (reload(next)) {
      console.log(`fixture switched to '${next}'`);
      return send(res, 200, { success: true, fixture: name });
    }
    return send(res, 404, {
      success: false,
      error: `unknown fixture '${next}'`,
    });
  }

  console.log(`${method} ${req.url}`);

  if (path === '/api/config') return send(res, 200, {});
  if (path === '/health/live' || path === '/health/ready')
    return send(res, 200, { status: 'ok' });
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
    return send(res, 200, {
      success: true,
      data: db.devices[idx],
      write: writeOk,
    });
  }

  const configMatch = /^\/api\/v1\/config\/([a-z0-9-]+)(?:\/(.*))?$/.exec(path);
  if (configMatch) {
    const endpoint = configMatch[1];
    const rest = configMatch[2] ? decodeURIComponent(configMatch[2]) : null;

    const failure = db.failures?.[`config/${endpoint}`];
    if (failure && method === 'GET') {
      return send(res, failure, {
        success: false,
        error: `${endpoint} is unavailable (simulated ${failure})`,
      });
    }
    if (db.lagMs && method === 'GET') await sleep(db.lagMs);

    if (method === 'GET') {
      if (rest) {
        // Single item GETs are used by detail pages; fall back to the list.
        const list = Array.isArray(db.config[endpoint])
          ? db.config[endpoint]
          : [];
        const item = list.find((i) => i.id === rest || i.device_key === rest);
        if (item) return send(res, 200, { success: true, data: item });
        console.log(`  !! no fixture item for config/${endpoint}/${rest}`);
        return send(res, 404, { success: false, error: 'not found' });
      }
      const special = SPECIAL_GET[endpoint];
      if (special) return send(res, 200, { success: true, data: special() });
      const list = Array.isArray(db.config[endpoint])
        ? db.config[endpoint]
        : [];
      return send(res, 200, { success: true, data: list });
    }

    if (method === 'POST' && rest === 'preview') {
      const body = await readBody(req);
      if (endpoint === 'routines') {
        return send(res, 200, {
          success: true,
          data: {
            will_trigger: true,
            assumed_trigger: body?.trigger_id ?? 't1',
            first_blocking_reason: null,
            steps: [],
            condition: { truth: 'true', trace: { kind: 'all', children: [] } },
          },
        });
      }
      return send(res, 200, {
        success: true,
        data: { samples: [], summary: 'fixture preview' },
      });
    }

    if (method === 'POST') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint])
        ? db.config[endpoint]
        : (db.config[endpoint] = []);
      if (endpoint === 'migrate' || endpoint === 'import')
        return send(res, 200, { success: true, data: { applied: true } });
      const item = { ...body };
      const idx = list.findIndex((i) => i.id === item.id);
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      return send(res, 200, { success: true, data: item, write: writeOk });
    }

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint])
        ? db.config[endpoint]
        : (db.config[endpoint] = []);
      if (endpoint === 'core' || endpoint === 'assistant') {
        return send(res, 200, { success: true, data: body, write: writeOk });
      }
      const id = rest ?? body?.id ?? body?.device_key;
      const idx = list.findIndex((i) => i.id === id || i.device_key === id);
      const item = {
        ...(idx >= 0 ? list[idx] : {}),
        ...body,
        id: id ?? body?.id,
      };
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      return send(res, 200, { success: true, data: item, write: writeOk });
    }

    if (method === 'DELETE') {
      const body = await readBody(req);
      const list = Array.isArray(db.config[endpoint])
        ? db.config[endpoint]
        : [];
      const id = rest ?? body?.id ?? body?.device_key;
      const idx = list.findIndex((i) => i.id === id || i.device_key === id);
      if (idx >= 0) list.splice(idx, 1);
      return send(res, 200, { success: true, data: { id }, write: writeOk });
    }
  }

  if (
    path === '/api/v1/config/floorplan/grid' ||
    path === '/api/v1/config/floorplan/image'
  ) {
    return send(res, 200, { success: true, data: {}, write: writeOk });
  }

  if (path.startsWith('/api/v1/config/assistant')) {
    return send(res, 200, {
      success: true,
      data: { threads: [], plans: [], actions: [] },
    });
  }
  if (path.startsWith('/api/v1/config/calibration')) {
    return send(res, 200, { success: true, data: [], write: writeOk });
  }

  console.warn(`  !! unhandled ${method} ${path}`);
  return send(res, 200, { success: true, data: [] });
});

/**
 * Synthetic runtime status for every v2 routine in the fixture: the first
 * trigger is armed with a due time, later triggers report their own state, the
 * condition carries a trace, and the most recent run has one dispatched and one
 * suppressed step. This is what lets the routine pages' live-state explanations
 * be reviewed without a real engine.
 */
function buildRoutineStatuses(db) {
  const statuses = {};
  for (const routine of db.config?.routines ?? []) {
    const definition = routine.definition_v2;
    if (!definition) continue;
    const triggers = definition.triggers ?? [];
    const steps = definition.program?.steps ?? [];
    const now = Date.now();
    const condition = definition.condition ?? { kind: 'literal', value: true };
    const children =
      condition.kind === 'all' || condition.kind === 'any'
        ? (condition.conditions ?? [])
        : [];
    const trace = {
      path: '/condition',
      truth: 'false',
      evaluated: true,
      children:
        children.length > 0
          ? children.map((child, index) => ({
              path: `/condition/conditions/${index}`,
              truth: index === 0 ? 'true' : 'false',
              evaluated: true,
            }))
          : undefined,
    };
    statuses[routine.id] = {
      all_conditions_match: false,
      will_trigger: false,
      rules: [],
      v2: {
        definition_revision: routine.revision ?? 1,
        fingerprint: `fixture-${routine.id}`,
        matched_trigger_ids: [],
        triggers: triggers.map((trigger, index) => ({
          trigger_id: trigger.id,
          kind: trigger.kind,
          fired: false,
          eligible: true,
          truth: index === 0 ? 'true' : 'unknown',
          armed: index === 0,
          due_wall_ms: index === 0 ? now + 90_000 : undefined,
          unknown_reason:
            index === 0
              ? undefined
              : { kind: 'stale', device: 'esphome/kitchen_counter' },
        })),
        condition: { truth: 'false', trace },
        will_trigger: false,
        execution_pending: false,
        last_run: {
          run_id: 12,
          definition_revision: routine.revision ?? 1,
          accepted: true,
          steps: steps.map((step, index) => ({
            action_id: step.id,
            kind: step.action,
            targets: [],
            disposition: index === 0 ? 'dispatched' : 'suppressed',
            reason:
              index === 0 ? undefined : 'skipped by the execution policy cap',
          })),
          dropped: 0,
        },
      },
    };
  }
  return statuses;
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

/**
 * Accept the live-state WebSocket upgrade and answer a `Resync` with a full
 * state frame. Without live state the UI treats a patch as a revision gap and
 * asks for exactly this, so the socket carries the fixture's synthetic routine
 * statuses instead of staying silent.
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
  let buffered = Buffer.alloc(0);
  // Nudge the client into the resync handshake: it has no revision yet, so a
  // revision-1 patch makes it ask for the full state, which is then sent below.
  socket.write(
    encodeTextFrame(
      JSON.stringify({
        Patch: { revision: 1, routine_statuses: { upserted: {}, removed: [] } },
      }),
    ),
  );
  const sendState = () => {
    const frame = {
      State: {
        revision: 1,
        // Keyed by device key, exactly like the server's state frame: the UI
        // reads live device state from here, not from the config endpoint.
        devices: Object.fromEntries(
          db.devices.map((device) => [
            `${device.integration_id}/${device.id}`,
            device,
          ]),
        ),
        scenes: {},
        groups: {},
        routine_statuses: buildRoutineStatuses(db),
        timers: [],
        helper_statuses: [],
        ui_state: {},
      },
    };
    socket.write(encodeTextFrame(JSON.stringify(frame)));
  };
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    // Client frames are masked; read the opcode/length, unmask, and look for a
    // Resync request. Anything else is ignored.
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        length = Number(buffered.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (buffered.length < offset + maskLength + length) return;
      let payload = buffered.subarray(
        offset + maskLength,
        offset + maskLength + length,
      );
      if (masked) {
        const mask = buffered.subarray(offset, offset + 4);
        payload = Buffer.from(
          payload.map((byte, index) => byte ^ mask[index % 4]),
        );
      }
      buffered = buffered.subarray(offset + maskLength + length);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode !== 0x1) continue;
      const text = payload.toString('utf8');
      console.log(`  ws <- ${text.slice(0, 120)}`);
      try {
        const message = JSON.parse(text);
        if (message && typeof message === 'object' && 'Resync' in message) {
          sendState();
          console.log('  ws -> full state frame');
        }
      } catch {
        // ignore malformed frames
      }
    }
  });
  socket.on('error', () => socket.destroy());
});

server.listen(port, '0.0.0.0', () => {
  console.log(`fixture server on http://127.0.0.1:${port} (fixture '${name}')`);
  console.log(
    `point the dev server at it: HOMECTL_DEV_PROXY_TARGET=http://127.0.0.1:${port} pnpm dev`,
  );
});

#!/usr/bin/env node
import { resolveDraftTarget, targetDeviceKeys } from '../lib/sceneDraft.ts';
import { orderedSceneTargets } from '../lib/sceneTargets.ts';
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
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
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

// Match the runtime websocket contract, not the configuration row contract.
// Deliberately excludes scripts: their execution is covered by the real server.
function fixtureSceneStates(scene) {
  const context = {
    devices: Object.fromEntries(
      db.devices.map((d) => [`${d.integration_id}/${d.id}`, d]),
    ),
    groups: db.config.groups ?? [],
    scenes: db.config.scenes ?? [],
  };
  const result = {};
  for (const kind of ['group', 'device']) {
    const targets =
      kind === 'group'
        ? orderedSceneTargets(scene.group_states ?? {}, scene.group_state_order)
        : Object.entries(scene.device_states ?? {});
    for (const [key, config] of targets) {
      for (const deviceKey of targetDeviceKeys(kind, key, context)) {
        const state = resolveDraftTarget(config, deviceKey, context);
        if (!state.reason)
          result[deviceKey] = {
            power: state.power ?? true,
            brightness: state.brightness ?? null,
            color: state.color ?? null,
            transition: state.transition ?? null,
          };
      }
    }
  }
  return result;
}

function reload(nextName) {
  if (!fixtures[nextName]) return false;
  name = nextName;
  db = fixtures[nextName]();
  for (const publish of statePublishers) publish();
  return true;
}

const writeOk = {
  applied: true,
  persistence: 'persisted',
  warning: null,
};

function send(res, status, body, extraHeaders = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  if (status >= 400) {
    console.log(`  <- ${status} ${payload.slice(0, 160)}`);
  }
  res.writeHead(status, {
    'content-type': 'application/json',
    'x-homectl-fixture': 'true',
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

/**
 * Diagnostics derived from the active fixture, so every issue names an item
 * that really exists in this data and every suggestion has a repair in the UI.
 * The codes mirror the server's config_diagnostics output.
 */
function buildDiagnostics() {
  const deviceKeys = new Set(
    (db.devices ?? []).map((device) => `${device.integration_id}/${device.id}`),
  );
  const groupIds = new Set((db.config.groups ?? []).map((group) => group.id));
  const sceneIds = new Set((db.config.scenes ?? []).map((scene) => scene.id));
  const issues = [];

  for (const scene of db.config.scenes ?? []) {
    for (const [key, config] of Object.entries(scene.device_states ?? {})) {
      // A target that follows another scene: the code matches the server's
      // missing_scene_link, so this page and the scene page agree on counts.
      const linkedScene =
        config && typeof config === 'object' ? config.scene_id : undefined;
      if (typeof linkedScene === 'string' && !sceneIds.has(linkedScene)) {
        issues.push({
          entity: 'scene',
          entity_id: scene.id,
          name: scene.name,
          code: 'missing_scene_link',
          severity: 'warning',
          message: `Target ${key} follows scene ${linkedScene}, which does not exist.`,
          suggestion:
            'Open the scene and pick an existing scene for that target, or remove it.',
        });
      }
      if (deviceKeys.has(key)) continue;
      issues.push({
        entity: 'scene',
        entity_id: scene.id,
        name: scene.name,
        code: 'missing_scene_device',
        device_keys: [key],
        severity: 'warning',
        message: `Target device ${key} is not available.`,
        suggestion:
          'Open the scene and choose another device for that target, or remove it.',
      });
    }
    for (const id of Object.keys(scene.group_states ?? {})) {
      if (groupIds.has(id)) continue;
      issues.push({
        entity: 'scene',
        entity_id: scene.id,
        name: scene.name,
        code: 'missing_scene_group',
        severity: 'warning',
        message: `Target room ${id} does not exist.`,
        suggestion: 'Choose an existing room for that target, or remove it.',
      });
    }
  }

  for (const group of db.config.groups ?? []) {
    const members =
      group.device_keys ??
      (group.devices ?? []).map(
        (member) => `${member.integration_id}/${member.device_id}`,
      );
    for (const key of members) {
      if (deviceKeys.has(key)) continue;
      issues.push({
        entity: 'group',
        entity_id: group.id,
        name: group.name,
        code: 'missing_group_device',
        device_keys: [key],
        severity: 'warning',
        message: `Device ${key} is not available in the current runtime.`,
        suggestion:
          'Check its integration, replace the device reference, or remove it from this room.',
      });
    }
    if (members.length === 0 && (group.linked_groups ?? []).length === 0) {
      issues.push({
        entity: 'group',
        entity_id: group.id,
        name: group.name,
        code: 'empty_group',
        severity: 'info',
        message: 'This room has no devices or nested rooms.',
        suggestion:
          'Add members if it should control devices. An intentionally empty room can be left as it is.',
      });
    }
  }

  return {
    warming_up: false,
    issues: issues.map((issue, index) => ({
      device_keys: [],
      id: `${issue.entity}/${issue.entity_id}/${issue.code}/${index}`,
      ...issue,
    })),
  };
}

// Synthetic health evidence for browser interaction checks. Real receipt,
// monotonic deadline and recovery behavior is tested in Rust, not here.
function buildDeviceHealth() {
  const now = Date.now();
  const devices = Object.fromEntries(
    (db.devices ?? []).map((device) => {
      const key = `${device.integration_id}/${device.id}`;
      const own = db.reportingPolicies?.[key] ?? { mode: 'inherit' };
      const integration = db.config.integrations?.find(
        (row) => row.id === device.integration_id,
      );
      const parent = integration?.reporting_policy ?? { mode: 'inherit' };
      const source =
        own.mode !== 'inherit'
          ? 'device'
          : parent.mode !== 'inherit'
            ? 'integration'
            : 'automatic';
      const policy = source === 'device' ? own : parent;
      const evidence = db.healthEvidence?.[key] ?? {};
      const last = evidence.last_fresh_report_ms ?? now - 1000;
      const grace =
        policy.mode === 'custom'
          ? Math.min(
              300,
              Math.max(5, Math.ceil(policy.expected_interval_seconds / 10)),
            )
          : 0;
      const deadline =
        policy.mode === 'custom'
          ? last + (policy.expected_interval_seconds + grace) * 1000
          : null;
      const label =
        db.config['device-display-names']?.find((row) => row.device_key === key)
          ?.display_name ?? device.name;
      const issues = [];
      if (deadline !== null && now > deadline)
        issues.push({
          code: 'missing_report',
          message: `${label} has not reported since ${new Date(last).toLocaleTimeString()}.`,
        });
      if (evidence.offline)
        issues.push({
          code: 'offline',
          message: `${label} was reported offline by ${device.integration_id}.`,
        });
      if (integration?.enabled === false) issues.length = 0;
      return [
        key,
        {
          device_key: key,
          integration_id: device.integration_id,
          name: label,
          status:
            integration?.enabled === false
              ? 'disabled'
              : evidence.offline
                ? 'offline'
                : issues.length
                  ? 'late'
                  : policy.mode === 'ignore'
                    ? 'ignored'
                    : 'healthy',
          effective_policy: {
            source,
            policy,
            description:
              source === 'device'
                ? 'Device override'
                : source === 'integration'
                  ? `Default for ${device.integration_id}`
                  : 'No periodic reporting guarantee; explicit offline signals are still checked',
            scheduling_grace_seconds: grace,
          },
          last_fresh_report_ms: last,
          last_cached_report_ms: null,
          expected_by_ms: deadline,
          issues,
        },
      ];
    }),
  );
  return {
    evaluated_at_ms: now,
    warming_up: false,
    devices,
    attention_device_keys: [
      ...new Set([
        ...Object.values(devices)
          .filter((row) => row.issues.length)
          .map((row) => row.device_key),
        ...buildDiagnostics()
          .issues.filter((row) => row.severity === 'warning')
          .flatMap((row) => row.device_keys ?? []),
      ]),
    ].sort(),
  };
}

/** config endpoint name -> array in db.config (or a special key) */
/**
 * The MQTT plugin's field metadata, mirroring
 * `server/src/core/integrations/mod.rs::integration_config_schema`. The fixture
 * has to carry it: without a schema a connection detail page cannot show
 * Primary settings, optional groups, or a masked secret, and the review would
 * be of an empty page rather than of the real one.
 */
function buildIntegrationSchemas() {
  const field = (overrides) => ({
    key: '',
    label: '',
    kind: 'text',
    required: false,
    description: null,
    placeholder: null,
    options: undefined,
    default_value: null,
    min: null,
    max: null,
    step: null,
    help_text: null,
    section: null,
    advanced: false,
    visible_when: null,
    ...overrides,
  });
  return [
    {
      plugin: 'mqtt',
      name: 'MQTT',
      description:
        'Connect generic MQTT devices, Zigbee2MQTT bridges, or ESPHome MQTT JSON lights.',
      fields: [
        field({
          key: 'host',
          label: 'Host',
          kind: 'text',
          required: true,
          description: 'MQTT broker hostname or IP address.',
          placeholder: 'mqtt.example.org',
          section: 'Connection',
        }),
        field({
          key: 'port',
          label: 'Port',
          kind: 'number',
          required: true,
          description: 'MQTT broker port.',
          placeholder: '1883',
          min: 1,
          max: 65535,
          step: 1,
          section: 'Connection',
        }),
        field({
          key: 'username',
          label: 'Username',
          kind: 'text',
          description: 'Optional MQTT username.',
          placeholder: 'homeassistant',
          section: 'Connection',
        }),
        field({
          key: 'password',
          label: 'Password',
          kind: 'password',
          description: 'Optional MQTT password.',
          section: 'Connection',
        }),
        field({
          key: 'mode',
          label: 'Mode',
          kind: 'select',
          required: true,
          description:
            'Generic MQTT: custom topics and payload mappings. Zigbee2MQTT: discover devices and capabilities from bridge metadata.',
          default_value: 'generic',
          section: 'Mode',
          options: [
            {
              label: 'Generic MQTT',
              value: 'generic',
              description: 'Custom MQTT topics and payload mappings.',
            },
            {
              label: 'Zigbee2MQTT',
              value: 'zigbee2mqtt',
              description:
                'Discover devices and capabilities from Zigbee2MQTT bridge metadata.',
            },
            {
              label: 'ESPHome',
              value: 'esphome',
              description:
                'ESPHome MQTT JSON lights using standard ESPHome light topics.',
            },
          ],
        }),
        field({
          key: 'topic',
          label: 'State topic',
          kind: 'text',
          required: true,
          description: 'Topic to subscribe to for device state messages.',
          placeholder: 'home/+/example/{id}',
          section: 'Topics',
          help_text:
            'Use `{id}` where the device id appears in the MQTT topic. `+` and `#` are supported subscription wildcards.',
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'topic_set',
          label: 'Command topic',
          kind: 'text',
          required: true,
          description: 'Topic used when publishing device state commands.',
          placeholder: 'home/lights/example/{id}/set',
          section: 'Topics',
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'zigbee2mqtt_base_topic',
          label: 'Base topic',
          kind: 'text',
          description: 'Zigbee2MQTT bridge base topic.',
          placeholder: 'zigbee2mqtt',
          section: 'Zigbee2MQTT',
          visible_when: { key: 'mode', equals: 'zigbee2mqtt' },
        }),
        // Match the ESPHome profile fields in core/integrations/mod.rs.
        ...[
          ['esphome_base_topic', 'Base topic', 'esphome'],
          ['esphome_light_object_id', 'Light object ID', 'light'],
          ['esphome_discovery_prefix', 'Discovery prefix', 'homeassistant'],
          ['esphome_warm_white_kelvin', 'Warm white', 2700],
          ['esphome_cold_white_kelvin', 'Cold white', 6500],
        ].map(([key, label, default_value]) =>
          field({
            key,
            label,
            default_value,
            description: {
              esphome_base_topic: 'ESPHome MQTT topic prefix.',
              esphome_light_object_id:
                'ESPHome light object id used in the normal MQTT light topic layout.',
              esphome_discovery_prefix:
                'Home Assistant MQTT discovery prefix published by ESPHome.',
              esphome_warm_white_kelvin:
                'Warm white endpoint of the ESPHome CWWW light.',
              esphome_cold_white_kelvin:
                'Cold white endpoint of the ESPHome CWWW light.',
            }[key],
            kind: typeof default_value === 'number' ? 'number' : 'text',
            placeholder: String(default_value),
            ...(typeof default_value === 'number'
              ? { min: 1, max: 65535, step: 1 }
              : {}),
            section: 'ESPHome',
            visible_when: { key: 'mode', equals: 'esphome' },
          }),
        ),
        field({
          key: 'sensor_value_fields',
          label: 'Sensor value fields',
          kind: 'json',
          section: 'Payload mapping',
          advanced: true,
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'managed',
          label: 'Management mode',
          kind: 'select',
          section: 'Advanced settings',
          advanced: true,
          options: [
            'Full',
            'Unmanaged',
            'FullReadOnly',
            'UnmanagedReadOnly',
          ].map((value) => ({
            value,
            label: {
              Full: 'Full',
              Unmanaged: 'Unmanaged',
              FullReadOnly: 'Full read-only',
              UnmanagedReadOnly: 'Unmanaged read-only',
            }[value],
            description: null,
          })),
        }),
        field({
          key: 'retain_commands',
          label: 'Retain generic commands',
          kind: 'boolean',
          section: 'Advanced settings',
          advanced: true,
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'disabled_device_ids',
          label: 'Disabled devices',
          kind: 'json',
          section: 'Advanced settings',
          advanced: true,
        }),
        field({
          key: 'brightness_range',
          label: 'Brightness range',
          default_value: [0, 1],
          kind: 'json',
          section: 'Payload mapping',
          advanced: true,
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'transition_range',
          label: 'Transition range',
          default_value: [0, 1],
          kind: 'json',
          section: 'Payload mapping',
          advanced: true,
          visible_when: { key: 'mode', equals: 'generic' },
        }),
        field({
          key: 'capabilities_override',
          label: 'Capabilities override',
          kind: 'json',
          section: 'Payload mapping',
          advanced: true,
          visible_when: { key: 'mode', equals: 'generic' },
        }),
      ],
    },
    {
      plugin: 'dummy',
      name: 'Dummy',
      description: 'Virtual devices for testing.',
      fields: [
        field({
          key: 'devices',
          label: 'Devices',
          kind: 'json',
          required: true,
        }),
      ],
    },
    {
      plugin: 'circadian',
      name: 'Circadian (legacy)',
      description: 'Legacy circadian integration.',
      fields: [],
    },
  ];
}

const SPECIAL_GET = {
  'source-presets': () => [
    {
      id: 'circadian',
      version: 1,
      name: 'Circadian',
      description:
        'Versioned circadian JavaScript preset. Fixture metadata uses the shipped script.',
      default_params: {
        day_fade_start: '06:00',
        day_fade_duration_hours: 2,
        day_color: { ct: 3000 },
        day_brightness: 0.8,
        night_fade_start: '20:00',
        night_fade_duration_hours: 2,
        night_color: { ct: 2000 },
        night_brightness: 0.2,
      },
      source_body: readFileSync(
        new URL(
          '../../server/src/core/automation/sources/presets/circadian_v1.js',
          import.meta.url,
        ),
        'utf8',
      ),
    },
  ],
  'device-health': () => buildDeviceHealth(),
  'integration-schemas': () => buildIntegrationSchemas(),
  'runtime-status': () => db.runtimeStatus,
  'routine-history': () => db.routineHistory,
  logs: () => db.logs,
  diagnostics: () => ({
    warming_up: false,
    issues: [
      ...buildDiagnostics().issues,
      ...Object.values(buildDeviceHealth().devices).flatMap((device) =>
        device.issues.map((issue) => ({
          id: `${device.device_key}/${issue.code}`,
          entity: 'device',
          entity_id: device.device_key,
          name: device.name,
          severity: 'warning',
          code: issue.code,
          message: issue.message,
          suggestion:
            'Check the device, its integration and its reporting policy.',
          device_keys: [device.device_key],
        })),
      ),
    ],
  }),
  'config-export': () => ({
    version: 1,
    exported_at: new Date().toISOString(),
  }),
};

// Synthetic restore contract; real validation and transaction semantics are
// covered by the Rust backup tests.
const backupSections = [
  ['integrations', 'Connections', 'id'],
  ['groups', 'Rooms & groups', 'id'],
  ['scenes', 'Scenes', 'id'],
  ['routines', 'Routines', 'id'],
  ['helpers', 'Helpers', 'id'],
  ['helper_values', 'Saved helper values', 'id'],
  ['sources', 'Computed sources', 'id'],
  ['floorplans', 'Floorplans', 'id'],
  ['group_positions', 'Room positions', 'group_id'],
  ['device_display_overrides', 'Device names', 'device_key'],
  ['device_color_calibrations', 'Device calibrations', 'device_key'],
  ['color_calibration_profiles', 'Calibration profiles', 'id'],
  ['color_calibration_assignments', 'Calibration assignments', 'device_key'],
  ['device_sensor_configs', 'Device controls', 'device_ref'],
  ['widget_settings', 'Shared settings & widget sources', 'key'],
  ['dashboard_layouts', 'Dashboards', 'id'],
  ['dashboard_widgets', 'Dashboard widgets', 'id'],
];
const fixtureBackup = () => ({
  version: 1,
  core: db.config.core ?? { warmup_time_seconds: 1 },
  floorplan: null,
  ...Object.fromEntries(
    backupSections.map(([key]) => [
      key,
      structuredClone(
        db.config[
          key === 'dashboard_layouts'
            ? 'dashboardLayouts'
            : key === 'dashboard_widgets'
              ? 'dashboardWidgets'
              : key
        ] ?? [],
      ),
    ]),
  ),
});
const backupToken = (candidate) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([fixtureBackup(), candidate]))
    .digest('hex');
function prepareBackup(body) {
  if (body?.version !== 1 || !body.core || !Array.isArray(body.groups))
    throw Error('Choose a supported homectl JSON backup.');
  const next = structuredClone(body),
    current = fixtureBackup();
  for (const row of next.integrations ?? []) {
    const old = current.integrations.find(
      (i) => i.id === row.id && i.plugin === row.plugin,
    );
    if (
      old?.config.password !== undefined &&
      !Object.hasOwn(row.config, 'password')
    )
      row.config.password = old.config.password;
  }
  return next;
}
function reviewBackup(candidate) {
  const current = fixtureBackup();
  const sections = backupSections.map(([key, label, idKey]) => {
    const before = current[key] ?? [],
      after = candidate[key] ?? [],
      changes = [];
    let unchanged = 0;
    for (const row of after) {
      const old = before.find((r) => r[idKey] === row[idKey]);
      if (old && isDeepStrictEqual(old, row)) {
        unchanged++;
        continue;
      }
      changes.push({
        id: String(row[idKey]),
        name: row.name ?? String(row[idKey]),
        action: old ? 'update' : 'add',
        fields: old
          ? Object.keys(row).filter((k) => !isDeepStrictEqual(row[k], old[k]))
          : [],
      });
    }
    for (const row of before)
      if (!after.some((r) => r[idKey] === row[idKey]))
        changes.push({
          id: String(row[idKey]),
          name: row.name ?? String(row[idKey]),
          action: 'remove',
          fields: [],
        });
    return {
      key,
      label,
      before: before.length,
      after: after.length,
      unchanged,
      changes,
    };
  });
  if (!isDeepStrictEqual(current.core, candidate.core))
    sections.push({
      key: 'core',
      label: 'System behavior',
      before: 1,
      after: 1,
      unchanged: 0,
      changes: [
        {
          id: 'core',
          name: 'System behavior',
          action: 'update',
          fields: ['value'],
        },
      ],
    });
  return {
    revision_token: backupToken(candidate),
    sections,
    destructive: sections.some((s) =>
      s.changes.some((c) => c.action !== 'add'),
    ),
    legacy_routines: 0,
    warnings: [
      'Restore replaces the saved setup. Pending routine timers are canceled.',
      'Omitted credentials for matching entries are kept.',
    ],
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const liveCommands = [];
let rejectLiveCommands = false;
let liveCommandDelay = 0;
const statePublishers = new Set();
const fixtureOverrides = new Map();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') return send(res, 204);

  if (path === '/api/__fixture/assistant')
    return send(res, 200, {
      success: true,
      data: db.assistantApplications ?? [],
    });
  if (path === '/api/v1/config/assistant/threads' && method === 'GET')
    return send(res, 200, { success: true, data: [] });
  if (path === '/api/v1/config/assistant/chat' && method === 'POST') {
    await readBody(req);
    const action = {
      actionId: 'fixture-reviewed-action',
      summary: 'Dim the living room lights',
      model: 'fixture-model',
      createdAtMs: Date.now(),
      changes: db.devices
        .filter(
          (d) =>
            d.integration_id === 'zigbee2mqtt' &&
            ['living_room_lamp', 'living_room_floor_lamp'].includes(d.id),
        )
        .map((d) => ({
          deviceKey: `${d.integration_id}/${d.id}`,
          name: d.name,
          power: true,
          brightness: 0.42,
          color: { h: 35, s: 0.6 },
        })),
    };
    db.assistantAction = action;
    db.assistantApplications = [];
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'x-homectl-fixture': 'true',
    });
    res.write(
      'event: status\ndata: {"phase":"planning","message":"Reviewing the selected lights"}\n\n',
    );
    res.end(`event: action\ndata: ${JSON.stringify(action)}\n\n`);
    return;
  }
  if (path.startsWith('/api/v1/config/assistant/actions/')) {
    if (method === 'DELETE') {
      db.assistantAction = null;
      return send(res, 200, { success: true, data: {} });
    }
    if (method === 'POST' && path.endsWith('/apply')) {
      const body = await readBody(req),
        action = db.assistantAction;
      if (!action)
        return send(res, 404, { success: false, error: 'Action unavailable' });
      const selected =
        body.deviceKeys ?? action.changes.map((c) => c.deviceKey);
      if (
        selected.some((key) => !action.changes.some((c) => c.deviceKey === key))
      )
        return send(res, 400, {
          success: false,
          error: 'Target outside this proposal',
        });
      (db.assistantApplications ??= []).push(selected);
      const results = action.changes
        .filter((c) => selected.includes(c.deviceKey))
        .map((change) => {
          // A deterministic partial failure tests how the review reports it.
          if (change.deviceKey.endsWith('/living_room_floor_lamp'))
            return {
              deviceKey: change.deviceKey,
              ok: false,
              error: 'Fixture integration rejected the command',
            };
          const device = db.devices.find(
            (d) => `${d.integration_id}/${d.id}` === change.deviceKey,
          );
          Object.assign(device.data.Controllable.state, {
            power: change.power,
            brightness: change.brightness,
            color: change.color,
          });
          return { deviceKey: change.deviceKey, ok: true, error: null };
        });
      for (const publish of statePublishers) publish();
      return send(res, 200, {
        success: true,
        data: {
          actionId: action.actionId,
          results,
          appliedCount: results.filter((r) => r.ok).length,
        },
      });
    }
  }

  // Synthetic calibration lifecycle for UI journeys; server tests cover the
  // real capability checks, database transaction and physical preview engine.
  if (path === '/api/__fixture/live-controls') {
    if (method === 'POST') {
      const value = await readBody(req);
      rejectLiveCommands = value.reject === true;
      liveCommandDelay = Math.min(2000, Math.max(0, value.delay ?? 0));
      if (value.clear) liveCommands.length = 0;
    }
    return send(res, 200, {
      commands: liveCommands,
      reject: rejectLiveCommands,
    });
  }
  if (path === '/api/__fixture/calibration') {
    if (method === 'POST') {
      const body = await readBody(req);
      if (body.seed) {
        db.config['calibration-profiles'] = [
          {
            id: 'shared-color',
            name: 'Shared color match',
            brightness: 0.5,
            reference_device_key: 'zigbee2mqtt/living_room_floor_lamp',
            points: [
              { reference: { u: 0.2, v: 0.47 }, output: { u: 0.21, v: 0.48 } },
            ],
            brightness_points: [],
          },
        ];
        db.config['calibration-assignments'] = [
          'zigbee2mqtt/living_room_lamp',
          'zigbee2mqtt/living_room_floor_lamp',
        ].map((device_key) => ({ device_key, profile_id: 'shared-color' }));
        db.calibrationSessions = {};
        db.calibrationEvents = [];
      }
      if (body.changeColor)
        db.config['calibration-profiles'][0].points[0].output.u =
          body.changeColor;
      db.calibrationFailSave = Boolean(body.failSave);
      db.calibrationFailStop = Boolean(body.failStop);
      db.calibrationStartDelay = Number(body.startDelay ?? 0);
    }
    return send(res, 200, {
      success: true,
      data: {
        events: db.calibrationEvents ?? [],
        sessions: db.calibrationSessions ?? {},
      },
    });
  }
  if (path === '/api/v1/config/calibration-editor') {
    const view = () => {
      const data = {
        profiles: db.config['calibration-profiles'] ?? [],
        assignments: db.config['calibration-assignments'] ?? [],
        legacy: db.config['device-color-calibrations'] ?? [],
      };
      return {
        ...data,
        revision_token: crypto
          .createHash('sha256')
          .update(JSON.stringify(data))
          .digest('hex'),
      };
    };
    if (method === 'GET')
      return send(res, 200, { success: true, data: view() });
    if (method === 'PUT') {
      const body = await readBody(req);
      (db.calibrationEvents ??= []).push({ method, path });
      if (body.expected !== view().revision_token)
        return send(res, 409, {
          success: false,
          error: 'Calibration changed elsewhere.',
          current: view(),
        });
      if (db.calibrationFailSave)
        return send(res, 500, {
          success: false,
          error: 'Fixture database write failed. No calibration was changed.',
        });
      if (Object.keys(db.calibrationSessions ?? {}).length)
        return send(res, 400, {
          success: false,
          error: 'Stop the preview before saving calibration.',
        });
      if (body.profile)
        db.config['calibration-profiles'] = [
          ...view().profiles.filter((row) => row.id !== body.profile.id),
          structuredClone(body.profile),
        ];
      db.config['calibration-assignments'] = [
        ...view().assignments.filter(
          (row) => !body.device_keys.includes(row.device_key),
        ),
        ...(body.profile_id
          ? body.device_keys.map((device_key) => ({
              device_key,
              profile_id: body.profile_id,
            }))
          : []),
      ];
      db.config['device-color-calibrations'] = view().legacy.filter(
        (row) => !body.device_keys.includes(row.device_key),
      );
      return send(res, 200, { success: true, data: view(), write: writeOk });
    }
  }
  if (/^\/api\/v1\/config\/calibration(-brightness)?-sessions\//.test(path)) {
    const id = path.split('/')[5];
    (db.calibrationEvents ??= []).push({ method, path, id });
    if (path.endsWith('/heartbeat'))
      return send(res, 200, { success: true, data: null });
    if (method === 'DELETE') {
      if (db.calibrationFailStop)
        return send(res, 503, {
          success: false,
          error: 'Fixture preview could not stop.',
        });
      delete (db.calibrationSessions ??= {})[id];
    } else {
      const body = await readBody(req);
      if (method === 'POST' && db.calibrationStartDelay)
        await sleep(db.calibrationStartDelay);
      (db.calibrationSessions ??= {})[id] = body;
    }
    return send(res, 200, { success: true, data: null });
  }

  if (path === '/api/__fixture/migration' && method === 'POST') {
    const body = await readBody(req);
    db.migrationFailure = !!body.fail;
    db.migrationMemoryOnly = !!body.memoryOnly;
    return send(res, 200, { success: true });
  }
  if (
    method === 'POST' &&
    ['/api/v1/config/migrate/review', '/api/v1/config/migrate/import'].includes(
      path,
    )
  ) {
    const body = await readBody(req);
    if (
      !Object.values(body.selection ?? {}).some(Boolean) ||
      !body.toml?.includes('[')
    )
      return send(res, 400, {
        success: false,
        error: 'Choose a supported TOML file and at least one section.',
      });
    // Deliberately limited fixture parser: Rust tests establish actual TOML semantics.
    const candidate = fixtureBackup();
    const headers = [
      ...body.toml.matchAll(
        /^\[(groups|integrations|routines)\.([^\]]+)\]\s*$/gm,
      ),
    ];
    const parsed = headers.map((header, index) => [
      header[0],
      header[1],
      header[2],
      body.toml.slice(
        header.index + header[0].length,
        headers[index + 1]?.index ?? body.toml.length,
      ),
    ]);
    const skipped = [];
    for (const [, section, id, fields] of parsed) {
      if (!body.selection[section]) continue;
      const field = (key) =>
        fields.match(new RegExp(`${key}\\s*=\\s*['"]([^'"]*)['"]`))?.[1];
      let row;
      if (section === 'groups')
        row = {
          id,
          name: field('name') ?? id,
          hidden: false,
          devices: [],
          linked_groups: [],
        };
      if (section === 'integrations')
        row = {
          id,
          plugin: field('plugin') ?? 'dummy',
          enabled: true,
          config: {},
        };
      if (section === 'routines') {
        row = {
          id,
          name: field('name') ?? id,
          enabled: !fields.includes('missing'),
          semantics_version: 1,
          rules: [],
          actions: [],
        };
        if (!row.enabled)
          skipped.push(
            `routine '${id}' was disabled because unresolved references were skipped`,
          );
      }
      const index = candidate[section].findIndex(
        (existing) => existing.id === id,
      );
      if (index < 0) candidate[section].push(row);
      else candidate[section][index] = row;
    }
    const review = reviewBackup(candidate);
    review.sections = review.sections.filter(
      (section) => body.selection[section.key],
    );
    review.warnings = [
      'Matching IDs are replaced; other entries are kept.',
      'Imported routines are read-only until converted. Routines with skipped references stay disabled.',
    ];
    review.revision_token = crypto
      .createHash('sha256')
      .update(
        JSON.stringify([backupToken(candidate), body.toml, body.selection]),
      )
      .digest('hex');
    if (path.endsWith('/review'))
      return send(res, 200, { success: true, data: { review, skipped } });
    if (body.expected !== review.revision_token)
      return send(res, 409, {
        success: false,
        error: 'The saved setup changed. Review this import again.',
      });
    if (skipped.length && !body.accept_skipped)
      return send(res, 400, {
        success: false,
        error: 'Acknowledge skipped references.',
      });
    if (db.migrationFailure)
      return send(res, 500, {
        success: false,
        error: 'Fixture import failed. Review again before retrying.',
      });
    for (const section of ['integrations', 'groups', 'routines'])
      if (body.selection[section]) db.config[section] = candidate[section];
    return send(res, 200, {
      success: true,
      data: {},
      write: db.migrationMemoryOnly
        ? {
            applied: true,
            persistence: 'memory_only',
            warning: 'Fixture import applied in memory only.',
          }
        : writeOk,
    });
  }

  if (path === '/api/__fixture/activity' && method === 'POST') {
    const body = await readBody(req);
    if (Array.isArray(body.entries)) db.routineHistory = body.entries;
    db.activityFailure = !!body.fail;
    return send(res, 200, { success: true });
  }
  if (path === '/api/v1/config/routine-history' && db.activityFailure) {
    return send(res, 503, {
      success: false,
      error: 'Fixture activity unavailable',
    });
  }

  if (path === '/api/__fixture/restore-outcome' && method === 'POST') {
    const body = await readBody(req);
    db.restoreFailure = !!body.fail;
    db.restoreMemoryOnly = !!body.memoryOnly;
    return send(res, 200, { success: true });
  }
  if (path === '/__health' && method === 'POST') {
    const evidence = await readBody(req);
    db.healthEvidence = { ...db.healthEvidence, ...evidence };
    const health = buildDeviceHealth();
    for (const key of Object.keys(evidence)) {
      for (const issue of health.devices[key]?.issues ?? []) {
        db.logs.unshift({
          timestamp: new Date().toISOString(),
          level: 'WARN',
          target: 'homectl_server::device_health',
          message: issue.message,
          references: [
            { entity: 'device', entity_id: key },
            { entity: 'integration', entity_id: key.split('/')[0] },
          ],
          details: { code: issue.code, fixture: true },
        });
      }
    }
    return send(res, 200, { success: true, data: health });
  }

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
  if (path === '/api/__fixture/arrangement-failure' && method === 'POST') {
    db.arrangementFailure = Boolean((await readBody(req)).fail);
    return send(res, 200, { success: true });
  }
  if (path === '/api/influxdb/temp-sensors')
    return send(
      res,
      200,
      ['render_living', 'render_bedroom'].flatMap((device_id, index) =>
        [0, 1].map((sample) => ({
          device_id,
          integration_id: 'influxdb',
          _field: 'tempc',
          _time: new Date(Date.now() - sample * 600000).toISOString(),
          _value: 21 + index + sample * 0.2,
        })),
      ),
    );
  if (path.startsWith('/api/v1/config/helpers')) {
    const parts = path
      .slice('/api/v1/config/helpers'.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const rows = (db.config.helpers ??= []);
    const definition = ({ value: _value, revision: _revision, ...row }) => row;
    if (method === 'GET' && !parts.length)
      return send(res, 200, { success: true, data: rows });
    if (method === 'PUT' && parts.length) {
      const body = await readBody(req),
        index = rows.findIndex((row) => row.id === parts[0]),
        current = rows[index];
      if (parts[1] === 'value') {
        if (!current)
          return send(res, 404, { success: false, error: 'Helper not found.' });
        current.value = body.value;
        current.revision += 1;
        return send(res, 200, { success: true, data: current, write: writeOk });
      }
      const { expected, create_only, ...next } = body;
      if (create_only && current)
        return send(res, 409, {
          success: false,
          error: 'This helper ID is already in use.',
        });
      if (expected && !current)
        return send(res, 404, {
          success: false,
          error: 'This helper was deleted.',
        });
      if (expected && !isDeepStrictEqual(expected, definition(current)))
        return send(res, 409, {
          success: false,
          error: 'This helper changed elsewhere.',
          current: definition(current),
        });
      const valid =
        current &&
        (next.kind.kind === 'boolean'
          ? typeof current.value === 'boolean'
          : next.kind.kind === 'string'
            ? typeof current.value === 'string'
            : next.kind.kind === 'enum'
              ? next.kind.options.includes(current.value)
              : typeof current.value === 'number' &&
                (next.kind.min === undefined ||
                  current.value >= next.kind.min) &&
                (next.kind.max === undefined ||
                  current.value <= next.kind.max));
      const saved = {
        ...next,
        value: valid ? current.value : next.initial_value,
        revision: valid ? current.revision : 0,
      };
      if (current) rows[index] = saved;
      else rows.push(saved);
      return send(res, 200, { success: true, data: saved, write: writeOk });
    }
    if (method === 'DELETE') {
      db.config.helpers = rows.filter((row) => row.id !== parts[0]);
      return send(res, 200, {
        success: true,
        data: { id: parts[0] },
        write: writeOk,
      });
    }
  }
  if (path === '/health/live' || path === '/health/ready')
    return send(res, 200, { status: 'ok' });
  if (path === '/api/v1/commands/scene') {
    const body = await readBody(req);
    console.log(`  -> scene command: ${JSON.stringify(body)}`);
    // Same shape the real command endpoint answers with.
    return send(res, 200, { applied: true, scene_id: body?.scene_id ?? null });
  }

  if (
    path === '/api/v1/config/value-history' ||
    path === '/api/v1/config/sensor-history'
  ) {
    const historyParams = new URL(req.url, 'http://fixture').searchParams;
    const source =
      historyParams.get('source_key') ?? historyParams.get('sensor');
    const before = Number(historyParams.get('before') ?? Infinity);
    const rows = (db.sensorHistory ?? [])
      .filter(
        (row) => (!source || row.source_key === source) && row.id < before,
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, 100);
    return send(res, 200, {
      success: true,
      data: path.endsWith('value-history')
        ? rows.map(({ changed_at_ms, value }) => ({ changed_at_ms, value }))
        : rows,
    });
  }
  if (path === '/api/__fixture/sensor-history' && method === 'POST') {
    const body = await readBody(req);
    db.sensorHistory = body.entries ?? [];
    if (body.configs) db.config['device-sensor-configs'] = body.configs;
    if (body.devices)
      for (const device of body.devices) {
        const i = db.devices.findIndex(
          (d) =>
            d.id === device.id && d.integration_id === device.integration_id,
        );
        if (i >= 0) db.devices[i] = device;
        else db.devices.push(device);
      }
    for (const publish of statePublishers) publish();
    return send(res, 200, { success: true });
  }
  if (path === '/api/v1/devices' && method === 'GET') {
    return send(res, 200, { devices: db.devices });
  }
  if (path.startsWith('/api/v1/devices/') && method === 'PUT') {
    const id = decodeURIComponent(path.slice('/api/v1/devices/'.length));
    const body = await readBody(req);
    const idx = db.devices.findIndex(
      (d) => d.id === id && d.integration_id === body.integration_id,
    );
    if (idx < 0) return send(res, 404, { error: 'Unknown device' });
    db.devices[idx] = { ...db.devices[idx], ...body };
    if (body.data?.Sensor) {
      const source_key = body.integration_id + '/' + id,
        value = body.data.Sensor.value ?? body.data.Sensor;
      const rows = (db.sensorHistory ??= []),
        last = rows.filter((r) => r.source_key === source_key).at(-1);
      if (JSON.stringify(last?.value) !== JSON.stringify(value))
        rows.push({
          id: Math.max(0, ...rows.map((r) => r.id)) + 1,
          source_key,
          changed_at_ms: Date.now(),
          value,
        });
    }
    for (const publish of statePublishers) publish();
    return send(res, 200, { devices: [db.devices[idx]] });
  }

  const floorplanEditor =
    /^\/api\/v1\/config\/floorplans\/([^/]+)\/editor$/.exec(path);
  if (floorplanEditor) {
    const id = decodeURIComponent(floorplanEditor[1]),
      rows = (db.config.floorplans ??= []);
    let row = rows.find((row) => row.id === id);
    const hash = (value) =>
      crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const publicRow = (row) => ({
      id: row.id,
      name: row.name,
      grid_data: row.grid_data ?? null,
      image: row._image
        ? {
            kind: 'stored',
            mime_type: row._image.mime_type,
            bytes: Buffer.from(row._image.data_base64, 'base64').length,
            revision: hash(row._image),
          }
        : { kind: 'none' },
      revision_token: hash(row),
    });
    if (row && !Object.hasOwn(row, 'grid_data')) {
      row.grid_data = JSON.stringify({
        width: 12,
        height: 9,
        tileSize: 32,
        deviceScale: 1,
        labelMode: 'all',
        tiles: Array.from({ length: 9 }, (_, y) =>
          Array.from({ length: 12 }, (_, x) =>
            x === 0 || y === 0 || x === 11 || y === 8 ? 'wall' : 'floor',
          ),
        ),
        devices: [
          {
            deviceKey: db.devices[0].integration_id + '/' + db.devices[0].id,
            deviceName: db.devices[0].name,
            x: 3,
            y: 3,
          },
        ],
        groups: {
          living_room: [
            { x: 1, y: 1 },
            { x: 1, y: 2 },
          ],
        },
        future: { keep: [2, 1] },
      });
      row._image = {
        mime_type: 'image/svg+xml',
        data_base64: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#f3f2ee"/></svg>',
        ).toString('base64'),
      };
    }
    if (method === 'GET')
      return row
        ? send(res, 200, { success: true, data: publicRow(row) })
        : send(res, 404, { success: false, error: 'Floorplan not found.' });
    const body = await readBody(req);
    if (body.create_only && row)
      return send(res, 409, {
        success: false,
        error: 'This floorplan ID is already in use.',
      });
    if (!body.create_only && !row)
      return send(res, 404, { success: false, error: 'Floorplan not found.' });
    if (row && body.expected !== publicRow(row).revision_token)
      return send(res, 409, {
        success: false,
        error: 'This floorplan changed elsewhere.',
        current: publicRow(row),
      });
    if (method === 'DELETE') {
      db.config.floorplans = rows.filter((r) => r.id !== id);
      return send(res, 200, { success: true, data: null, write: writeOk });
    }
    if (!body.name?.trim())
      return send(res, 400, {
        success: false,
        error: 'Give the floorplan a name.',
      });
    if (!row) {
      row = { id, name: body.name };
      rows.push(row);
    }
    row.name = body.name;
    row.grid_data = body.grid_data;
    if (body.image.kind === 'none') delete row._image;
    if (body.image.kind === 'upload')
      row._image = {
        mime_type: body.image.mime_type,
        data_base64: body.image.data_base64,
      };
    return send(res, body.create_only ? 201 : 200, {
      success: true,
      data: publicRow(row),
      write: writeOk,
    });
  }
  if (path === '/api/v1/config/floorplan/grid') {
    const saved = db.config.floorplans?.find(
      (row) => row.id === (url.searchParams.get('id') ?? 'default'),
    );
    if (saved && Object.hasOwn(saved, 'grid_data'))
      return send(res, 200, {
        success: true,
        data: saved.grid_data,
        write: writeOk,
      });
    // A small two-room plan with a wall, a door, and a window so the editor
    // has real content to render.
    const width = 12;
    const height = 9;
    const tiles = [];
    for (let y = 0; y < height; y += 1) {
      const row = [];
      for (let x = 0; x < width; x += 1) {
        const isBorder =
          x === 0 || y === 0 || x === width - 1 || y === height - 1;
        row.push(isBorder ? 'wall' : 'floor');
      }
      tiles.push(row);
    }
    for (let y = 1; y < height - 1; y += 1) {
      tiles[y][6] = y === 5 ? 'door' : 'wall';
    }
    tiles[0][3] = 'window';
    const grid = {
      width,
      height,
      tiles,
      tileSize: 32,
      deviceScale: 1,
      labelMode: 'sensors',
      devices: [
        {
          deviceKey: 'zigbee2mqtt/living_room_lamp',
          deviceName: 'Living room lamp',
          x: 3,
          y: 2,
        },
        {
          deviceKey: 'zigbee2mqtt/floor_lamp',
          deviceName: 'Floor lamp',
          x: 4,
          y: 6,
        },
      ],
      groups: {
        living_room: [
          { x: 1, y: 1 },
          { x: 1, y: 2 },
          { x: 2, y: 1 },
          { x: 2, y: 2 },
        ],
        kitchen: [
          { x: 8, y: 1 },
          { x: 8, y: 2 },
          { x: 9, y: 1 },
          { x: 9, y: 2 },
        ],
      },
    };
    return send(res, 200, {
      success: true,
      data: JSON.stringify(grid),
      write: writeOk,
    });
  }

  if (path === '/api/v1/config/floorplan/image') {
    const row = db.config.floorplans?.find(
      (row) => row.id === (url.searchParams.get('id') ?? 'default'),
    );
    if (row && Object.hasOwn(row, 'grid_data')) {
      if (!row._image)
        return send(res, 404, {
          success: false,
          error: 'Floorplan image not found.',
        });
      res.writeHead(200, {
        'content-type': row._image.mime_type,
        'x-homectl-fixture': 'true',
      });
      res.end(Buffer.from(row._image.data_base64, 'base64'));
      return;
    }
    // A one pixel transparent PNG: enough for the background layer to exist.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(png);
    return undefined;
  }

  // Stateless preview of a draft source definition
  // (server/src/api/config/sources.rs::preview_source).
  if (path === '/api/v1/config/source-preview' && method === 'POST') {
    const body = await readBody(req);
    if (body.compute?.kind === 'script' && !body.compute.preset)
      return send(res, 200, {
        success: true,
        data: {
          timezone: body.timezone,
          samples: [],
          step_ms: 0,
          day_start_ms: 0,
          unsupported_reason:
            'Custom script previews are unavailable in this fixture.',
        },
      });
    const timezone = body?.timezone ?? 'UTC';
    const count = Math.min(Math.max(Number(body?.samples ?? 24), 1), 96);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const stepMs = Math.round((24 * 60 * 60 * 1000) / count);
    const samples = Array.from({ length: count }, (_value, index) => {
      const timeMs = dayStart.getTime() + index * stepMs;
      const hour = (index * 24) / count;
      // A day-shaped curve: dim at night, full around midday.
      const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      return {
        time_ms: timeMs,
        local_time: `${String(Math.floor(hour)).padStart(2, '0')}:00`,
        profile: {
          brightness: Number(daylight.toFixed(3)),
          color: { h: 32, s: 0.35 },
          transition: null,
        },
      };
    });
    return send(res, 200, {
      success: true,
      data: {
        timezone,
        day_start_ms: dayStart.getTime(),
        step_ms: stepMs,
        samples,
        note: 'Synthetic fixture samples; computation is verified by backend tests.',
      },
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

    if (endpoint === 'export' && method === 'GET') {
      const config = fixtureBackup();
      if (url.searchParams.get('include_secrets') !== 'true')
        for (const row of config.integrations) delete row.config.password;
      return send(res, 200, { success: true, data: config });
    }
    if (endpoint === 'import' && method === 'POST') {
      let body;
      try {
        body = prepareBackup(await readBody(req));
      } catch (error) {
        return send(res, 400, { success: false, error: error.message });
      }
      if (rest === 'preview')
        return send(res, 200, { success: true, data: reviewBackup(body) });
      if (url.searchParams.get('expected') !== backupToken(body))
        return send(res, 409, {
          success: false,
          error: 'Configuration changed since review.',
        });
      if (db.restoreFailure)
        return send(res, 500, {
          success: false,
          error: 'Restore failed. The uploaded backup is kept.',
        });
      db.config.core = body.core;
      for (const [key] of backupSections)
        db.config[
          key === 'dashboard_layouts'
            ? 'dashboardLayouts'
            : key === 'dashboard_widgets'
              ? 'dashboardWidgets'
              : key
        ] = body[key] ?? [];
      return send(res, 200, {
        success: true,
        data: null,
        write: db.restoreMemoryOnly
          ? {
              applied: true,
              persistence: 'memory_only',
              warning: 'Fixture restore is applied in memory only.',
            }
          : writeOk,
      });
    }
    if (endpoint === 'dashboard') {
      const layouts = (db.config.dashboardLayouts ??= [
        { id: 1, name: 'Home', is_default: true },
      ]);
      const widgets = (db.config.dashboardWidgets ??= [
        {
          id: 1,
          layout_id: 1,
          widget_type: 'sensors',
          config: {
            title: 'Indoor readings',
            options: {
              sensorIds: ['living', 'bedroom'],
              sensorSelection: 'selected',
              influxToken: 'fixture-widget-token',
              future: { keep: [1, 2] },
            },
          },
          grid_x: 0,
          grid_y: 0,
          grid_w: 2.25,
          grid_h: 2,
          sort_order: 0,
        },
      ]);
      const token = (row) =>
        crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
      const publicRow = (row) => {
        const value = structuredClone(row),
          secret_fields = [];
        if (row.config) {
          const options = value.config.options ?? value.config;
          for (const field of row.widget_type === 'sensors'
            ? ['influxToken']
            : row.widget_type === 'clock'
              ? ['calendarUrl']
              : []) {
            if (options[field]) secret_fields.push(field);
            delete options[field];
            delete value.config[field];
          }
        }
        return {
          ...value,
          revision_token: token(row),
          ...(row.config ? { secret_fields } : {}),
        };
      };
      const parts = (rest ?? '').split('/');
      if (parts[0] === 'layouts' && parts[2] === 'arrangement') {
        const layoutId = Number(parts[1]);
        const view = () => ({
          layout_id: layoutId,
          removed_ids: [],
          placements: Object.fromEntries(
            widgets
              .filter((row) => row.layout_id === layoutId)
              .map((row) => [
                String(row.id),
                {
                  grid_x: row.grid_x,
                  grid_y: row.grid_y,
                  grid_w: row.grid_w,
                  grid_h: row.grid_h,
                  sort_order: row.sort_order,
                  revision_token: token(row),
                },
              ]),
          ),
        });
        if (method === 'GET')
          return send(res, 200, { success: true, data: view() });
        if (method === 'PUT') {
          const { value, expected } = await readBody(req);
          if (!isDeepStrictEqual(view(), expected))
            return send(res, 409, {
              success: false,
              error: 'Widgets in this layout changed.',
              current: view(),
            });
          if (db.arrangementFailure)
            return send(res, 500, {
              success: false,
              error: 'The arrangement transaction failed. Your draft is kept.',
            });
          if (
            value.layout_id !== layoutId ||
            Object.keys(value.placements).sort().join(',') !==
              Object.keys(view().placements).sort().join(',')
          )
            return send(res, 400, {
              success: false,
              error: 'Include every current widget.',
            });
          for (const row of widgets.filter(
            (row) => row.layout_id === layoutId,
          )) {
            const { revision_token: _revision, ...placement } =
              value.placements[row.id];
            Object.assign(row, placement);
          }
          db.config.dashboardWidgets = widgets.filter(
            (row) =>
              row.layout_id !== layoutId || !value.removed_ids.includes(row.id),
          );
          return send(res, 200, {
            success: true,
            data: {
              ...view(),
              placements: Object.fromEntries(
                Object.entries(view().placements).filter(
                  ([id]) => !value.removed_ids.includes(Number(id)),
                ),
              ),
            },
            write: writeOk,
          });
        }
      }
      if (method === 'GET' && rest === 'layouts')
        return send(res, 200, { success: true, data: layouts.map(publicRow) });
      if (method === 'GET' && parts[0] === 'layouts' && parts[2] === 'widgets')
        return send(res, 200, {
          success: true,
          data: widgets
            .filter((row) => row.layout_id === Number(parts[1]))
            .map(publicRow),
        });
      if (method === 'POST' && (rest === 'layouts' || rest === 'widgets')) {
        const {
            expected,
            revision_token: _token,
            secret_fields: _fields,
            ...value
          } = await readBody(req),
          list = rest === 'layouts' ? layouts : widgets;
        const current = list.find((row) => row.id === value.id);
        if (expected && (!current || expected !== token(current)))
          return send(res, 409, {
            success: false,
            error: 'This item changed elsewhere.',
            current: current ? publicRow(current) : undefined,
          });
        if (!value.id) value.id = Math.max(0, ...list.map((row) => row.id)) + 1;
        if (current?.config && current.widget_type === value.widget_type) {
          const options = value.config.options ?? value.config;
          for (const field of value.widget_type === 'sensors'
            ? ['influxToken']
            : value.widget_type === 'clock'
              ? ['calendarUrl']
              : [])
            if (
              !(field in options) &&
              field in (current.config.options ?? current.config)
            )
              options[field] = (current.config.options ?? current.config)[
                field
              ];
        }
        if (rest === 'layouts' && value.is_default)
          layouts.forEach((row) => (row.is_default = false));
        if (current) list[list.indexOf(current)] = value;
        else list.push(value);
        return send(res, 200, {
          success: true,
          data: publicRow(value),
          write: writeOk,
        });
      }
      if (method === 'DELETE') {
        if (parts[0] === 'layouts') {
          db.config.dashboardLayouts = layouts.filter(
            (row) => row.id !== Number(parts[1]),
          );
          db.config.dashboardWidgets = widgets.filter(
            (row) => row.layout_id !== Number(parts[1]),
          );
        } else
          db.config.dashboardWidgets = widgets.filter(
            (row) => row.id !== Number(parts[1]),
          );
        return send(res, 200, { success: true, data: null, write: writeOk });
      }
    }

    if (
      endpoint === 'assistant' &&
      (rest === 'settings' || rest === 'status')
    ) {
      const current = db.config.assistantSettings ?? {
        baseUrl: 'https://provider.example/v1',
        model: 'fixture-model',
        apiKey: 'fixture-stored-key',
        reasoningEffort: null,
        timezone: 'Europe/Helsinki',
        timeoutMs: 60000,
        maxTokens: 2048,
        contextWindow: 128000,
      };
      const view = (row) => {
        const { apiKey, ...publicFields } = row;
        return {
          ...publicFields,
          enabled: Boolean(row.baseUrl && row.model),
          apiKeySet: Boolean(apiKey),
          revisionToken: crypto
            .createHash('sha256')
            .update(JSON.stringify(row))
            .digest('hex'),
        };
      };
      if (method === 'GET')
        return send(res, 200, {
          success: true,
          data:
            rest === 'status'
              ? {
                  enabled: Boolean(current.baseUrl && current.model),
                  model: current.model,
                }
              : view(current),
        });
      if (method === 'PUT' && rest === 'settings') {
        const { expected, ...value } = await readBody(req);
        if (expected && expected.revisionToken !== view(current).revisionToken)
          return send(res, 409, {
            success: false,
            error: 'Assistant settings changed elsewhere.',
            current: view(current),
          });
        const next = { ...current, ...value };
        for (const key of ['baseUrl', 'model', 'reasoningEffort', 'timezone'])
          next[key] ||= null;
        db.config.assistantSettings = next;
        return send(res, 200, {
          success: true,
          data: view(next),
          write: writeOk,
        });
      }
    }

    if (endpoint === 'core') {
      const current = db.config.core ?? {
        warmup_time_seconds: 1,
        default_transition_ms: 1200,
        scene_transition_ms: 2400,
        weather_api_url: '',
        train_api_url: '',
        influx_url: '',
      };
      if (method === 'GET')
        return send(res, 200, { success: true, data: current });
      if (method === 'PUT') {
        const { expected, ...value } = await readBody(req);
        if (expected && !isDeepStrictEqual(expected, current))
          return send(res, 409, {
            success: false,
            error: 'System settings changed elsewhere.',
            current,
          });
        db.config.core = { ...current, ...value };
        return send(res, 200, {
          success: true,
          data: db.config.core,
          write: writeOk,
        });
      }
    }

    if (endpoint === 'widget-sources') {
      const sources = (db.config.widgetSources ??= {
        influxdb: {
          url: 'http://influx.example',
          token: 'fixture-source-token',
          future: { keep: true },
        },
        calendar: { icsUrl: 'https://calendar.example/private-fixture-feed' },
        weather: { apiUrl: '' },
        train_schedule: { apiUrl: '' },
      });
      const view = (key) => {
        const row = sources[key],
          secret =
            key === 'influxdb'
              ? 'token'
              : key === 'calendar'
                ? 'icsUrl'
                : undefined;
        const fields =
          key === 'influxdb'
            ? ['url', 'token']
            : key === 'calendar'
              ? ['icsUrl']
              : ['apiUrl'];
        return {
          key,
          config: Object.fromEntries(
            fields
              .filter((field) => field !== secret)
              .map((field) => [field, row[field] ?? '']),
          ),
          credentials: secret ? { [secret]: Boolean(row[secret]) } : {},
          origins: Object.fromEntries(
            fields.map((field) => [field, row[field] ? 'saved' : 'unset']),
          ),
          invalidStoredConfig: false,
          revisionToken: crypto
            .createHash('sha256')
            .update(JSON.stringify(row))
            .digest('hex'),
        };
      };
      if (method === 'GET')
        return send(res, 200, {
          success: true,
          data: Object.keys(sources).map(view),
        });
      if (method === 'PUT' && sources[rest]) {
        const { config, expected } = await readBody(req);
        if (expected !== view(rest).revisionToken)
          return send(res, 409, {
            success: false,
            error: 'This source changed elsewhere.',
            current: view(rest),
          });
        sources[rest] = { ...sources[rest], ...config };
        return send(res, 200, {
          success: true,
          data: view(rest),
          write: writeOk,
        });
      }
    }

    if (endpoint === 'sensors' && rest === 'catalog') {
      const current = db.config.sensorCatalog ?? { sensors: [], groups: [] };
      if (method === 'GET')
        return send(res, 200, { success: true, data: current });
      if (method === 'PUT') {
        const { expected, ...value } = await readBody(req);
        if (expected && !isDeepStrictEqual(expected, current))
          return send(res, 409, {
            success: false,
            error: 'Sensor catalog changed elsewhere.',
            current,
          });
        const ids = new Set(value.sensors.map((row) => row.id));
        if (
          ids.size !== value.sensors.length ||
          value.sensors.some((row) => !row.id.trim() || !row.name.trim()) ||
          value.groups.some(
            (group) =>
              !group.name.trim() || group.sensorIds.some((id) => !ids.has(id)),
          )
        )
          return send(res, 400, {
            success: false,
            error: 'Invalid sensor catalog.',
          });
        db.config.sensorCatalog = value;
        return send(res, 200, { success: true, data: value, write: writeOk });
      }
    }

    if (endpoint === 'integrations') {
      const list = db.config.integrations ?? [];
      const publicRow = (row) => {
        const token = crypto
          .createHash('sha256')
          .update(JSON.stringify(row))
          .digest('hex');
        const { password, ...config } = row.config;
        return {
          ...row,
          config,
          revision_token: token,
          secret_fields: password ? ['password'] : [],
          reporting_policy: row.reporting_policy ?? { mode: 'inherit' },
        };
      };
      if (method === 'GET') {
        const item = rest ? list.find((row) => row.id === rest) : null;
        return rest
          ? send(res, item ? 200 : 404, {
              success: Boolean(item),
              data: item ? publicRow(item) : undefined,
            })
          : send(res, 200, { success: true, data: list.map(publicRow) });
      }
      if (method === 'PUT' || method === 'POST') {
        const {
          expected,
          revision_token: _token,
          secret_fields: _fields,
          ...value
        } = await readBody(req);
        const index = list.findIndex((row) => row.id === (rest ?? value.id)),
          current = list[index];
        if (
          (method === 'POST' && current) ||
          (expected &&
            (!current ||
              expected.revision_token !== publicRow(current).revision_token))
        )
          return send(res, 409, {
            success: false,
            error: 'Integration settings changed elsewhere.',
            current: current ? publicRow(current) : undefined,
          });
        if (method === 'PUT' && !current)
          return send(res, 404, {
            success: false,
            error: 'Integration no longer exists.',
          });
        if (
          current?.plugin === value.plugin &&
          !Object.hasOwn(value.config, 'password') &&
          current.config.password !== undefined
        )
          value.config.password = current.config.password;
        if (current) list[index] = value;
        else list.push(value);
        db.config.integrations = list;
        return send(res, 200, {
          success: true,
          data: publicRow(value),
          write: writeOk,
        });
      }
    }
    if (endpoint === 'sources' && method === 'PUT') {
      const { expected, create_only, ...source } = await readBody(req),
        rows = (db.config.sources ??= []),
        index = rows.findIndex((row) => row.id === rest),
        current = rows[index];
      if (create_only && current)
        return send(res, 409, {
          success: false,
          error: 'This source ID is already in use.',
        });
      if (expected && !current)
        return send(res, 404, {
          success: false,
          error: 'This source was deleted.',
        });
      if (expected && !isDeepStrictEqual(expected, current))
        return send(res, 409, {
          success: false,
          error: 'This source changed elsewhere.',
          current,
        });
      source.revision = (current?.revision ?? 0) + 1;
      if (current) rows[index] = source;
      else rows.push(source);
      db.config.sources = rows;
      return send(res, 200, { success: true, data: source, write: writeOk });
    }
    if (endpoint === 'device-settings') {
      const body = method === 'PUT' ? await readBody(req) : undefined;
      const key = body?.device_key ?? url.searchParams.get('device_key');
      const current = {
        device_key: key,
        reporting_policy: db.reportingPolicies?.[key] ?? { mode: 'inherit' },
        display_name:
          db.config['device-display-names']?.find(
            (row) => row.device_key === key,
          )?.display_name ?? null,
        sensor:
          db.config['device-sensor-configs']?.find(
            (row) => row.device_ref === key,
          ) ?? null,
      };
      if (method === 'GET')
        return send(res, 200, { success: true, data: current });
      if (!isDeepStrictEqual(current, body.expected))
        return send(res, 409, {
          success: false,
          error: 'Device settings changed elsewhere.',
          current,
        });
      const { expected: _expected, ...value } = body;
      (db.reportingPolicies ??= {})[key] = value.reporting_policy ?? {
        mode: 'inherit',
      };
      db.config['device-display-names'] = (
        db.config['device-display-names'] ?? []
      ).filter((row) => row.device_key !== key);
      db.config['device-sensor-configs'] = (
        db.config['device-sensor-configs'] ?? []
      ).filter((row) => row.device_ref !== key);
      if (value.display_name !== null)
        db.config['device-display-names'].push({
          device_key: key,
          display_name: value.display_name,
        });
      if (value.sensor !== null)
        db.config['device-sensor-configs'].push(value.sensor);
      return send(res, 200, { success: true, data: value, write: writeOk });
    }
    if (endpoint === 'timers') {
      const current = (db.userTimers ??= { timers: [], legacy_migrated: true });
      if (method === 'GET')
        return send(res, 200, {
          success: true,
          data: current,
          storage_available: true,
        });
      if (method === 'POST' && rest.endsWith('/stop')) {
        const id = decodeURIComponent(rest.slice(0, -5));
        const timer = current.timers.find((t) => t.definition.id === id);
        if (!timer)
          return send(res, 404, { success: false, error: 'Timer not found' });
        timer.definition.enabled = false;
        timer.runtime = {
          next_start_ms: null,
          finish_ms: null,
          active: false,
          pending: null,
          last_message: 'Cancelled',
          last_run_ms: null,
        };
        return send(res, 200, { success: true, data: current });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        if (
          !isDeepStrictEqual(
            body.expected,
            current.timers.map((t) => t.definition),
          )
        )
          return send(res, 409, {
            success: false,
            error: 'Timers changed elsewhere.',
            current: { timers: current.timers.map((t) => t.definition) },
          });
        current.timers = body.timers.map(
          (definition) =>
            current.timers.find((t) =>
              isDeepStrictEqual(t.definition, definition),
            ) ?? {
              definition,
              runtime: {
                next_start_ms: definition.enabled
                  ? Date.now() + (definition.schedule.minutes ?? 30) * 60000
                  : null,
                finish_ms: null,
                active: false,
                pending: null,
                last_message: null,
                last_run_ms: null,
              },
            },
        );
        return send(res, 200, { success: true, data: current });
      }
    }
    if (endpoint === 'preferences') {
      const current = db.config.preferences ?? { show_advanced_details: true };
      if (method === 'GET')
        return send(res, 200, { success: true, data: current });
      const { expected, ...next } = await readBody(req);
      if (expected && !isDeepStrictEqual(current, expected))
        return send(res, 409, {
          success: false,
          error: 'Preferences changed elsewhere.',
          current,
        });
      db.config.preferences = next;
      return send(res, 200, { success: true, data: next, write: writeOk });
    }
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

    if (
      method === 'POST' &&
      endpoint === 'routines' &&
      ['convert', 'preview', 'schedule-preview'].includes(rest)
    ) {
      return send(res, 501, {
        success: false,
        error:
          'The development fixture does not evaluate routine previews or conversions. Use the Rust server for these operations.',
      });
    }
    if (method === 'POST' && rest === 'preview') {
      const body = await readBody(req);
      if (endpoint === 'scenes') {
        if (body.script)
          return send(res, 400, {
            success: false,
            error:
              'The development fixture does not execute scripts. Use the Rust server for script previews.',
          });
        const context = {
          scenes: [
            ...db.config.scenes.filter((scene) => scene.id !== body.id),
            body,
          ],
          groups: db.config.groups,
          devices: Object.fromEntries(
            db.devices.map((device) => [
              device.integration_id + '/' + device.id,
              device,
            ]),
          ),
        };
        const devices = {};
        for (const [kind, targets] of [
          ['group', body.group_states],
          ['device', body.device_states],
        ])
          for (const [key, config] of kind === 'group'
            ? orderedSceneTargets(targets ?? {}, body.group_state_order)
            : Object.entries(targets ?? {}))
            for (const deviceKey of targetDeviceKeys(kind, key, context)) {
              if (!context.devices[deviceKey]) continue;
              const state = resolveDraftTarget(config, deviceKey, context);
              if (!state.reason)
                devices[deviceKey] = {
                  state,
                  source: {
                    scope: kind,
                    kind: 'device_state',
                    group_id: kind === 'group' ? key : null,
                  },
                };
            }
        return send(res, 200, {
          success: true,
          data: {
            devices,
            active_overrides: [],
            script_evaluated: false,
            evaluated_at: new Date().toISOString(),
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
      if (endpoint === 'groups' && idx >= 0)
        return send(res, 409, {
          success: false,
          error: 'This ID is already in use. Choose another ID.',
        });
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
      if (body?.expected !== undefined) {
        const { device_keys: _derived, ...current } = list[idx] ?? {};
        if (idx < 0)
          return send(res, 404, {
            success: false,
            error: 'This item was deleted.',
          });
        if (!isDeepStrictEqual(body.expected, current))
          return send(res, 409, {
            success: false,
            error: 'This item changed elsewhere.',
            current,
          });
        delete body.expected;
      }
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
        scenes: Object.fromEntries(
          (db.config.scenes ?? []).map((scene) => [
            scene.id,
            {
              name: scene.name,
              hidden: scene.hidden ?? false,
              devices: fixtureSceneStates(scene),
              active_overrides: fixtureOverrides.get(scene.id) ?? [],
            },
          ]),
        ),
        // FlattenedGroupsConfig: keyed by group id, device keys as
        // "integration/device" strings.
        groups: Object.fromEntries(
          (db.config.groups ?? []).map((group) => [
            group.id,
            {
              name: group.name,
              hidden: group.hidden ?? false,
              linked_groups: group.linked_groups ?? [],
              device_keys: (group.devices ?? []).map(
                (member) => `${member.integration_id}/${member.device_id}`,
              ),
            },
          ]),
        ),
        routine_statuses: buildRoutineStatuses(db),
        timers: [],
        helper_statuses: db.config.helpers ?? [],
        ui_state: {},
      },
    };
    socket.write(encodeTextFrame(JSON.stringify(frame)));
  };
  statePublishers.add(sendState);
  socket.on('close', () => statePublishers.delete(sendState));
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
        if (message.DeviceCommand || message.SceneCommand) {
          const command = message.DeviceCommand ?? message.SceneCommand;
          const kind = message.DeviceCommand
            ? 'DeviceCommandResult'
            : 'SceneCommandResult';
          liveCommands.push(message);
          let error = rejectLiveCommands
            ? 'Fixture runtime rejected this command.'
            : null;
          let affected = 0;
          if (!error && message.DeviceCommand) {
            const device = db.devices.find(
              (d) => `${d.integration_id}/${d.id}` === command.device_key,
            );
            if (
              !device?.data.Controllable ||
              device.data.Controllable.disabled ||
              ['FullReadOnly', 'UnmanagedReadOnly'].includes(
                device.data.Controllable.managed,
              )
            )
              error = 'Device is unavailable or read-only.';
            else {
              for (const field of [
                'power',
                'brightness',
                'color',
                'transition',
              ])
                if (command[field] != null)
                  device.data.Controllable.state[field] = command[field];
              affected = 1;
            }
          } else if (!error) {
            const scene = db.config.scenes.find(
              (s) => s.id === command.scene_id,
            );
            if (!scene) error = 'Scene not found.';
            else
              for (const [key, value] of Object.entries(
                fixtureSceneStates(scene),
              )) {
                if (command.device_keys && !command.device_keys.includes(key))
                  continue;
                const device = db.devices.find(
                  (d) => `${d.integration_id}/${d.id}` === key,
                );
                if (
                  device?.data.Controllable &&
                  !device.data.Controllable.disabled &&
                  !['FullReadOnly', 'UnmanagedReadOnly'].includes(
                    device.data.Controllable.managed,
                  )
                ) {
                  device.data.Controllable.state = value;
                  if (command.transition != null)
                    device.data.Controllable.state.transition =
                      command.transition;
                  device.data.Controllable.scene_id = command.scene_id;
                  device.data.Controllable.scene_paused = false;
                  affected++;
                }
              }
          }
          setTimeout(() => {
            if (socket.destroyed) return;
            socket.write(
              encodeTextFrame(
                JSON.stringify({
                  [kind]: {
                    request_id: command.request_id,
                    applied: !error,
                    error,
                    affected_devices: affected,
                  },
                }),
              ),
            );
            sendState();
          }, liveCommandDelay);
        }
        const action = message.EventMessage?.Action;
        if (action?.action === 'ToggleDeviceOverride') {
          for (const key of action.device_keys ?? []) {
            const device = db.devices.find(
              (d) => `${d.integration_id}/${d.id}` === key,
            );
            const id = device?.data.Controllable?.scene_id;
            if (!id) continue;
            const keys = new Set(fixtureOverrides.get(id) ?? []);
            if (action.override_state) keys.add(key);
            else keys.delete(key);
            fixtureOverrides.set(id, [...keys]);
          }
          sendState();
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

/**
 * Development fixtures for the Settings UX work. These are never runtime
 * defaults: `fixture-server.mjs` serves them only when a developer runs it
 * explicitly, and every value here is synthetic.
 *
 * Shapes mirror the real API responses (captured from a live instance):
 * - `/api/v1/devices` -> { devices: Device[] }
 * - `/api/v1/config/<endpoint>` -> { success, data: item[] }
 * - `/api/v1/config/runtime-status` -> { persistence_available, memory_only_mode }
 */

/** Requested-vs-reported helper for a controllable device. */
function controllable(
  id,
  name,
  integration,
  {
    power = true,
    brightness = 0.7,
    color = { h: 30, s: 0.5 },
    sceneId = null,
    online = true,
    receivedAgoMs = 4000,
    reportPower = null,
    reportBrightness = null,
    reportColor = null,
  } = {},
) {
  const now = Date.now();
  const state = {
    power,
    brightness,
    color,
    transition: null,
  };
  const reportState = {
    power: reportPower ?? power,
    brightness: reportBrightness ?? brightness,
    color: reportColor ?? color,
    transition: null,
  };
  const matchesRequested =
    reportState.power === state.power &&
    reportState.brightness === state.brightness &&
    JSON.stringify(reportState.color) === JSON.stringify(state.color);
  return {
    id,
    name,
    integration_id: integration,
    data: {
      Controllable: {
        disabled: false,
        availability: { online, observed_at_ms: now - receivedAgoMs },
        last_report: {
          state: reportState,
          received_at_ms: now - receivedAgoMs,
          retained: false,
          matches_requested: matchesRequested,
        },
        requested_at_ms: now - receivedAgoMs - 1500,
        scene_id: sceneId,
        state_source: { kind: 'Manual', scope: 'Device' },
        capabilities: {},
        state,
        managed: 'Full',
      },
    },
    raw: null,
  };
}

/** Push button / sensor device. */
function sensor(id, name, integration, value) {
  return {
    id,
    name,
    integration_id: integration,
    data: { Sensor: { value } },
    raw: null,
  };
}

function group(id, name, devices, linkedGroups = []) {
  // Groups store references, not device copies (matches the server payload).
  const refs = devices.map((device) => ({
    integration_id: device.integration_id,
    device_id: device.device_id ?? device.id,
  }));
  return {
    id,
    name,
    hidden: false,
    devices: refs,
    linked_groups: linkedGroups,
    device_keys: refs.map((d) => `${d.integration_id}/${d.device_id}`),
  };
}

function scene(id, name, { deviceStates = {}, groupStates = {} } = {}) {
  return {
    id,
    name,
    hidden: false,
    script: null,
    device_states: deviceStates,
    group_states: groupStates,
    group_state_order: Object.keys(groupStates),
  };
}

function v2Routine(id, name, { triggers, conditions, steps, enabled = true, revision = 1 }) {
  return {
    id,
    name,
    enabled,
    semantics_version: 2,
    revision,
    definition_v2: {
      triggers,
      condition: conditions,
      program: { kind: 'native', steps },
      execution: { mode: 'queued', max_actions: 32 },
    },
    rules: [],
    actions: [],
  };
}

function v1Routine(id, name, { rules, actions, enabled = true }) {
  return { id, name, enabled, semantics_version: 1, revision: 1, rules, actions };
}

function helper(id, name, kind, value, persistence = 'persistent') {
  return {
    id,
    name,
    kind: { kind },
    value,
    initial_value: value,
    revision: 1,
    persistence,
    hidden: false,
  };
}

function source(id, name, compute, aliases = [`${id}/color`]) {
  return {
    id,
    name,
    enabled: true,
    revision: 1,
    timezone: 'Europe/Helsinki',
    refresh_interval_ms: 30000,
    aliases,
    compute,
  };
}

function integration(id, plugin, config, enabled = true) {
  return { id, plugin, config, enabled };
}

/* ------------------------------------------------------------------ normal */

function normalHome() {
  const devices = [
    controllable('living_room_lamp', 'Living room lamp', 'zigbee2mqtt', { brightness: 0.8, color: { h: 32, s: 0.4 } }),
    controllable('living_room_floor_lamp', 'Floor lamp', 'zigbee2mqtt', { power: false, brightness: null, color: null }),
    controllable('kitchen_counter', 'Kitchen counter', 'esphome', { brightness: 0.65, color: { h: 28, s: 0.35 } }),
    controllable('kitchen_pendant', 'Kitchen pendant', 'esphome', { brightness: 1, color: { h: 30, s: 0.2 } }),
    controllable('bedroom_lamp', 'Bedroom lamp', 'zigbee2mqtt', { power: false, brightness: null, color: null, sceneId: 'normal' }),
    controllable('bedroom_lamp_2', 'Bedroom lamp 2', 'zigbee2mqtt', { power: false, brightness: null, color: null, sceneId: 'normal' }),
    controllable('office_desk', 'Desk light', 'zigbee2mqtt', { brightness: 0.9, color: { h: 210, s: 0.2 } }),
    controllable('hallway_strip', 'Hallway strip', 'mqtt', { brightness: 0.4, color: { h: 25, s: 0.7 } }),
    sensor('entryway_button', 'Entryway button', 'zigbee2mqtt', 'idle'),
    sensor('bedroom_switch', 'Bedroom switch', 'zigbee2mqtt', 'idle'),
    sensor('living_room_motion', 'Living room motion', 'zigbee2mqtt', 'clear'),
    sensor('outdoor_sensor', 'Outdoor temperature', 'mqtt', 4.5),
  ];
  return {
    runtimeStatus: { persistence_available: true, memory_only_mode: false },
    devices,
    config: {
      groups: [
        group(
          'all',
          'All',
          [
            ...devices.filter((d) => 'Controllable' in d.data),
            // One member that no longer exists, so the "missing member" states
            // stay exercised instead of only appearing by accident.
            { integration_id: 'zigbee2mqtt', device_id: 'living_room_spot_retired' },
          ],
          ['office'],
        ),
        group('living_room', 'Living room', [
          { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' },
          { integration_id: 'zigbee2mqtt', device_id: 'living_room_floor_lamp' },
        ]),
        group('kitchen', 'Kitchen', [
          { integration_id: 'esphome', device_id: 'kitchen_counter' },
          { integration_id: 'esphome', device_id: 'kitchen_pendant' },
        ]),
        group('bedroom', 'Bedroom', [
          { integration_id: 'zigbee2mqtt', device_id: 'bedroom_lamp' },
          { integration_id: 'zigbee2mqtt', device_id: 'bedroom_lamp_2' },
        ]),
        group('office', 'Office', [{ integration_id: 'zigbee2mqtt', device_id: 'office_desk' }]),
        group('hallway', 'Hallway', [{ integration_id: 'mqtt', device_id: 'hallway_strip' }]),
      ],
      scenes: [
        scene('normal', 'Normal', {
          group_states: {
            living_room: { power: true, brightness: 0.8, color: { h: 32, s: 0.4 } },
            kitchen: { power: true, brightness: 0.8, color: { h: 30, s: 0.3 } },
            bedroom: { power: true, brightness: 1, color: { h: 30, s: 0.5 } },
            office: { power: true, brightness: 0.9, color: { h: 210, s: 0.2 } },
          },
        }),
        scene('dark', 'Dark', {
          group_states: {
            living_room: { power: true, brightness: 0.25, color: { h: 25, s: 0.95 } },
            kitchen: { power: true, brightness: 0.25, color: { h: 25, s: 0.95 } },
            bedroom: { power: true, brightness: 0.25, color: { h: 25, s: 0.95 } },
          },
        }),
        scene('night', 'Night', {
          group_states: {
            living_room: { power: false },
            kitchen: { power: false },
            bedroom: { power: false },
          },
        }),
        scene('movie', 'Movie', {
          device_states: {
            'zigbee2mqtt/living_room_lamp': { power: true, brightness: 0.15, color: { h: 260, s: 0.8 } },
            'zigbee2mqtt/living_room_floor_lamp': { power: true, brightness: 0.1, color: { h: 260, s: 0.8 } },
          },
          group_states: { kitchen: { power: false } },
        }),
      ],
      routines: [
        v2Routine('bedroom_down', 'Bedroom switch down', {
          triggers: [{ id: 't1', kind: 'device_state', device: { integration_id: 'zigbee2mqtt', device_id: 'bedroom_switch' }, state: { value: 'down_press' } }],
          conditions: { kind: 'all', conditions: [{ kind: 'true' }] },
          steps: [{ kind: 'activate_scene', scene_id: 'dark', group_keys: ['bedroom'] }],
        }),
        v2Routine('motion_on', 'Living room motion on', {
          triggers: [{ id: 't1', kind: 'device_state', device: { integration_id: 'zigbee2mqtt', device_id: 'living_room_motion' }, state: { value: 'detected' } }],
          conditions: {
            kind: 'all',
            conditions: [
              { kind: 'time_window', start: '07:00', end: '23:00' },
              { kind: 'compare', left: { source: 'helper', id: 'entryway_cooldown' }, op: 'eq', right: { literal: false } },
            ],
          },
          steps: [{ kind: 'activate_scene', scene_id: 'normal', group_keys: ['living_room'] }],
        }),
        v2Routine('entryway_nightlight', 'Entryway nightlight', {
          triggers: [{ id: 't1', kind: 'device_state', device: { integration_id: 'zigbee2mqtt', device_id: 'entryway_button' }, state: { value: 'press' } }],
          conditions: { kind: 'all', conditions: [{ kind: 'compare', left: { source: 'sun' }, op: 'eq', right: { literal: 'below_horizon' } }] },
          steps: [{ kind: 'activate_scene', scene_id: 'dark', group_keys: ['hallway'] }],
        }),
        v1Routine('legacy_hallway', 'Hallway motion (legacy)', {
          rules: [{ any: [{ integration_id: 'mqtt', device_id: 'outdoor_sensor', state: { value: 4.5 } }] }],
          actions: [{ action: 'ActivateScene', scene_id: 'dark', group_keys: ['hallway'] }],
        }),
        v2Routine('kitchen_day', 'Kitchen daytime', {
          triggers: [
            { id: 't1', kind: 'schedule', schedule: { kind: 'daily', at: '07:30' } },
            { id: 't2', kind: 'device_state', device: { integration_id: 'esphome', device_id: 'kitchen_counter' }, state: { power: false } },
          ],
          conditions: { kind: 'all', conditions: [{ kind: 'time_window', start: '06:00', end: '18:00' }] },
          steps: [
            { kind: 'activate_scene', scene_id: 'normal', group_keys: ['kitchen'] },
            { kind: 'activate_scene', scene_id: 'normal', group_keys: ['living_room'] },
          ],
        }),
      ],
      helpers: [helper('entryway_cooldown', 'Entryway cooldown', 'boolean', false)],
      sources: [
        source('circadian', 'Circadian rhythm', {
          kind: 'circadian_compat',
          preset_version: 1,
          params: {
            day_fade_start: '04:00',
            day_fade_duration_hours: 2,
            day_color: { h: 32, s: 0.35 },
            day_brightness: 0.9,
            night_fade_start: '18:00',
            night_fade_duration_hours: 3,
            night_color: { h: 25, s: 0.9 },
            night_brightness: 0.25,
          },
        }),
      ],
      integrations: [
        integration('mqtt', 'mqtt', { host: 'mqtt.example.test', port: 1883, managed: 'Unmanaged', topic: 'home/devices/{id}', topic_set: 'home/devices/{id}/set' }),
        integration('zigbee2mqtt', 'mqtt', { host: 'mqtt.example.test', port: 1883, managed: 'Zigbee2Mqtt', topic: 'zigbee2mqtt/{id}', topic_set: 'zigbee2mqtt/{id}/set' }),
        integration('esphome', 'esphome', { host: 'esphome.example.test', port: 6053 }),
      ],
      devices: [],
      floorplans: [],
      device_display_overrides: [],
      device_sensor_configs: [],
      device_color_calibrations: [],
      calibration_profiles: [],
      calibration_assignments: [],
      group_positions: [],
      dashboard_layouts: [],
      dashboard_widgets: [],
      widget_settings: [],
    },
    routineHistory: [
      {
        id: '9001',
        timestamp: new Date(Date.now() - 47 * 60_000).toISOString(),
        routine_id: 'motion_on',
        routine_name: 'Living room motion on',
        trigger_kind: 'v2_run',
        event_source_device_key: 'zigbee2mqtt/living_room_motion',
        action_count: 1,
        status: null,
        v2: {
          definition_revision: 3,
          fingerprint: 'a1b2c3d4e5f60718',
          matched_trigger_ids: ['t1'],
          triggers: [{ id: 't1', kind: 'device_state', matched: true }],
          condition: { truth: 'true', trace: { kind: 'all', children: [] } },
          will_trigger: true,
        },
      },
    ],
    logs: [
      { timestamp: new Date(Date.now() - 90_000).toISOString(), level: 'INFO', target: 'homectl_server::core::routines', message: 'Routine triggered: id=bedroom_down' },
      { timestamp: new Date(Date.now() - 120_000).toISOString(), level: 'WARN', target: 'homectl_server::integrations::mqtt', message: 'Could not find device esphome/kitchen_pendant in state' },
    ],
  };
}

/* ------------------------------------------------------------------- large */

function largeHome() {
  const base = normalHome();
  const integrations = ['zigbee2mqtt', 'esphome', 'mqtt', 'tasmota'];
  const rooms = [
    'living_room', 'kitchen', 'bedroom', 'office', 'hallway', 'bathroom',
    'dining_room', 'guest_room', 'garage', 'sauna', 'utility', 'outdoor',
  ];
  const devices = [...base.devices];
  const groups = [...base.config.groups];
  const deviceStates = {};

  for (let room = 0; room < rooms.length; room += 1) {
    const members = [];
    for (let i = 0; i < 25; i += 1) {
      const integration = integrations[(room + i) % integrations.length];
      const id = `${rooms[room]}_device_${i}`;
      const power = (room + i) % 5 !== 0;
      devices.push(
        controllable(id, `${rooms[room].replace(/_/g, ' ')} light ${i + 1}`, integration, {
          power,
          brightness: power ? 0.5 : null,
          color: power ? { h: (i * 17) % 360, s: 0.4 } : null,
          receivedAgoMs: 2000 + i * 250,
        }),
      );
      members.push({ integration_id: integration, device_id: id });
      deviceStates[`${integration}/${id}`] = { power, brightness: power ? 0.5 : null, color: power ? { h: (i * 17) % 360, s: 0.4 } : null };
    }
    groups.push(group(rooms[room], rooms[room].replace(/_/g, ' '), members));
  }

  // A scene with many targets, one nested group reference, and a per-device override.
  const manyTargetStates = { ...deviceStates };
  const manyTargets = scene('whole_house', 'Whole house', {
    device_states: manyTargetStates,
    group_states: {
      all: { power: true, brightness: 0.8, color: { h: 32, s: 0.4 } },
      outdoor: { power: false },
      garage: { scene_id: 'normal' },
    },
  });

  // A routine with deeply nested conditions and many steps.
  const deepConditions = {
    kind: 'all',
    conditions: [
      { kind: 'time_window', start: '06:30', end: '22:30' },
      { kind: 'compare', left: { source: 'sun' }, op: 'eq', right: { literal: 'below_horizon' } },
      {
        kind: 'any',
        conditions: [
          { kind: 'compare', left: { source: 'helper', id: 'entryway_cooldown' }, op: 'eq', right: { literal: false } },
          {
            kind: 'all',
            conditions: [
              { kind: 'compare', left: { source: 'device', device: { integration_id: 'zigbee2mqtt', device_id: 'living_room_motion' } }, op: 'eq', right: { literal: 'clear' } },
              { kind: 'time_window', start: '23:00', end: '05:00' },
              {
                kind: 'any',
                conditions: [
                  { kind: 'compare', left: { source: 'helper', id: 'entryway_cooldown' }, op: 'eq', right: { literal: true } },
                  { kind: 'true' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const manySteps = [
    { kind: 'activate_scene', scene_id: 'normal', group_keys: ['living_room'] },
    { kind: 'activate_scene', scene_id: 'dark', group_keys: ['bedroom'] },
    { kind: 'set_helper_value', helper_id: 'entryway_cooldown', value: true },
    { kind: 'delay', seconds: 30 },
    { kind: 'activate_scene', scene_id: 'night', group_keys: ['kitchen'] },
    { kind: 'activate_scene', scene_id: 'movie', group_keys: ['living_room'] },
    { kind: 'set_device_state', device: { integration_id: 'mqtt', device_id: 'hallway_strip' }, state: { power: false } },
  ];

  const routines = [
    ...base.config.routines,
    v2Routine('everything_evening', 'Everything in the evening', { triggers: [{ id: 't1', kind: 'schedule', schedule: { kind: 'daily', at: '17:45' } }], conditions: deepConditions, steps: manySteps, revision: 7 }),
  ];
  for (let i = 0; i < 55; i += 1) {
    routines.push(
      v2Routine(`generated_routine_${i}`, `${rooms[i % rooms.length].replace(/_/g, ' ')} routine ${i + 1}`, {
        triggers: [{ id: 't1', kind: 'schedule', schedule: { kind: 'daily', at: `${String(6 + (i % 16)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}` } }],
        conditions: { kind: 'all', conditions: [{ kind: 'true' }] },
        steps: [{ kind: 'activate_scene', scene_id: i % 2 === 0 ? 'normal' : 'dark', group_keys: [rooms[i % rooms.length]] }],
        enabled: i % 7 !== 0,
      }),
    );
  }
  for (let i = 0; i < 15; i += 1) {
    const groupStates = {};
    for (const room of rooms.slice(0, 4 + (i % 6))) {
      groupStates[room] = { power: i % 3 !== 0, brightness: 0.2 + (i % 5) * 0.15, color: { h: (i * 23) % 360, s: 0.5 } };
    }
    base.config.scenes.push(scene(`generated_scene_${i}`, `Generated scene ${i + 1}`, { groupStates }));
  }
  base.config.scenes.push(manyTargets);

  return {
    ...base,
    devices,
    config: { ...base.config, groups, routines, scenes: base.config.scenes },
  };
}

/* ----------------------------------------------------------------- degraded */

function degradedHome() {
  const base = normalHome();
  // A scene whose target no longer resolves, and a device that is offline with
  // a stale report that disagrees with the requested state.
  base.config.scenes.push(
    scene('evening', 'Evening', {
      device_states: {
        'zigbee2mqtt/living_room_lamp': { power: true, brightness: 0.3, color: { h: 30, s: 0.6 } },
        'zigbee2mqtt/removed_lamp': { power: true, brightness: 0.5, color: { h: 30, s: 0.5 } },
      },
      group_states: { kitchen: { power: true, brightness: 0.5, color: { h: 30, s: 0.5 } } },
    }),
  );
  const devices = base.devices.map((d) => {
    if (d.id !== 'hallway_strip') return d;
    return controllable('hallway_strip', 'Hallway strip', 'mqtt', {
      power: true,
      brightness: 0.4,
      color: { h: 25, s: 0.7 },
      online: false,
      receivedAgoMs: 47 * 60_000,
      reportPower: false,
      reportBrightness: null,
      reportColor: null,
    });
  });
  return {
    ...base,
    devices,
    failures: { 'config/routines': 500 },
  };
}

/* -------------------------------------------------------------------- empty */

function emptyHome() {
  return {
    runtimeStatus: { persistence_available: true, memory_only_mode: false },
    devices: [],
    config: {
      groups: [], scenes: [], routines: [], helpers: [], sources: [],
      integrations: [], devices: [], floorplans: [], device_display_overrides: [],
      device_sensor_configs: [], device_color_calibrations: [], calibration_profiles: [],
      calibration_assignments: [], group_positions: [], dashboard_layouts: [],
      dashboard_widgets: [], widget_settings: [],
    },
    routineHistory: [],
    logs: [],
  };
}

export const fixtures = {
  empty: emptyHome,
  normal: normalHome,
  large: largeHome,
  degraded: degradedHome,
};

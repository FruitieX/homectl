import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeComparisonNarrative,
  describeRoutineLastOutcome,
  describeRoutineHistoryEvidence,
  describeRoutineStateLine,
  describeConditionNarrative,
  describeScheduleNarrative,
  describeTriggerNarrative,
  formatDurationWords,
  formatReading,
  readSourceValue,
} from './routineNarrative.ts';

// Device data mirrors the server payload: sensors expose /value, controllable
// devices carry a requested state and the last reported state.
const context = {
  devices: {
    'zigbee2mqtt/living_room_motion': {
      id: 'living_room_motion',
      name: 'Living room motion',
      integration_id: 'zigbee2mqtt',
      data: { Sensor: { value: true } },
    },
    'zigbee2mqtt/living_room_lamp': {
      id: 'living_room_lamp',
      name: 'Living room lamp',
      integration_id: 'zigbee2mqtt',
      data: {
        Controllable: {
          state: { power: true, brightness: 0.45, color: { h: 32, s: 0.4 } },
          last_report: {
            state: { power: true, brightness: 0.45, color: { h: 32, s: 0.4 } },
          },
        },
      },
    },
  },
  groups: { living_room: { name: 'Living room' } },
  helpers: [
    { id: 'entryway_cooldown', name: 'Entryway cooldown', value: false },
  ],
};

test('state-change triggers read as a sentence, not a mode', () => {
  assert.equal(
    describeTriggerNarrative(
      {
        kind: 'state_change',
        device: {
          integration_id: 'zigbee2mqtt',
          device_id: 'living_room_motion',
        },
        mode: 'transition',
      },
      context,
    ),
    'When Living room motion becomes active',
  );
});

test('report triggers name the field', () => {
  assert.equal(
    describeTriggerNarrative(
      {
        kind: 'report',
        device: {
          integration_id: 'zigbee2mqtt',
          device_id: 'living_room_motion',
        },
        field: 'illuminance',
      },
      context,
    ),
    'When Living room motion reports illuminance',
  );
});

test('schedules translate cron into words and keep the raw form as detail', () => {
  const daily = describeScheduleNarrative({
    cron: '30 7 * * *',
    timezone: 'Europe/Helsinki',
  });
  assert.equal(daily.text, 'every day at 07:30');
  assert.equal(daily.detail, '30 7 * * * · Europe/Helsinki');

  assert.equal(
    describeScheduleNarrative({ cron: '0 30 7 * * *' }).text,
    'every day at 07:30',
  );
  assert.equal(
    describeScheduleNarrative({ cron: '0 7 * * 1' }).text,
    'every Monday at 07:00',
  );
  assert.equal(
    describeScheduleNarrative({ cron: '*/15 * * * *' }).text,
    'every 15 minutes',
  );
  assert.equal(
    describeScheduleNarrative({ cron: '0 */2 * * *' }).text,
    'every 2 hours',
  );
  assert.equal(
    describeScheduleNarrative({ cron: '15 6 1 * *' }).text,
    'every month on the 1st at 06:15',
  );
  const odd = describeScheduleNarrative({ cron: '0 0 7 15 3 *' });
  assert.equal(odd.text, 'on a custom schedule');
  assert.equal(odd.detail, '0 0 7 15 3 *');

  assert.equal(
    describeScheduleNarrative({ every_ms: 90_000 }).text,
    'every 2 minutes',
  );
});

test('comparisons name the reading and the limit', () => {
  const { text, evidence } = describeComparisonNarrative(
    {
      kind: 'comparison',
      source: {
        kind: 'device',
        device: {
          integration_id: 'zigbee2mqtt',
          device_id: 'living_room_lamp',
        },
        path: '/brightness',
      },
      operator: '<',
      value: 0.3,
    },
    context,
  );
  // The rule and today's reading stay separate: the rule is the condition,
  // the evidence is the reading that currently makes it false.
  assert.equal(text, 'Living room lamp brightness is below 30%');
  assert.equal(evidence, 'brightness is 45%');
});

test('missing readings are reported as waiting for data, not as false', () => {
  const source = {
    kind: 'device' as const,
    device: { integration_id: 'zigbee2mqtt', device_id: 'hallway_sensor' },
    path: '/illuminance',
  };
  const live = readSourceValue(source, context);
  assert.equal(live.known, false);
  const { text, evidence } = describeComparisonNarrative(
    { kind: 'comparison', source, operator: '<', value: 100 },
    context,
  );
  assert.equal(text, 'hallway_sensor illuminance is below 100');
  assert.equal(evidence, undefined);
});

test('nested conditions join with and/or and keep their evidence', () => {
  const { text, evidence } = describeConditionNarrative(
    {
      kind: 'all',
      conditions: [
        {
          kind: 'comparison',
          source: {
            kind: 'device',
            device: {
              integration_id: 'zigbee2mqtt',
              device_id: 'living_room_lamp',
            },
            path: '/brightness',
          },
          operator: '<',
          value: 0.3,
        },
        { kind: 'literal', value: true },
      ],
    },
    context,
  );
  assert.equal(text, 'Living room lamp brightness is below 30% and always');
  assert.equal(evidence, 'brightness is 45%');
});

test('room conditions read as membership statements', () => {
  assert.equal(
    describeConditionNarrative(
      {
        kind: 'group',
        group_id: 'living_room',
        quantifier: 'any',
        power: true,
      },
      context,
    ).text,
    'at least one light is on in Living room',
  );
});

test('readings carry their units', () => {
  assert.equal(formatReading('/brightness', 0.8), '80%');
  assert.equal(formatReading('/power', true), 'on');
  assert.equal(formatReading('/temperature', 21), '21°');
  assert.equal(formatReading('/value', 3), '3');
});

test('a false condition says which reading is short', () => {
  const line = describeRoutineStateLine({
    enabled: true,
    definition: {
      condition: {
        kind: 'comparison',
        source: {
          kind: 'device',
          device: {
            integration_id: 'zigbee2mqtt',
            device_id: 'living_room_lamp',
          },
          path: '/brightness',
        },
        operator: '<',
        value: 0.3,
      },
    },
    status: { condition: { truth: 'false' } },
    context,
  });
  assert.equal(
    line.text,
    'Waiting for its trigger — the current condition is not met',
  );
  assert.equal(line.tone, 'neutral');
});

test('waiting for data is reserved for unreadable inputs', () => {
  const unknown = describeRoutineStateLine({
    enabled: true,
    status: {
      condition: {
        truth: 'unknown',
        unknown_reason: { kind: 'offline', device: 'hallway_sensor' },
      },
    },
    context,
    describeUnknown: () => 'Hallway sensor is offline',
  });
  assert.equal(unknown.text, 'Waiting for data: Hallway sensor is offline');
  assert.equal(unknown.tone, 'warning');

  const quiet = describeRoutineStateLine({
    enabled: true,
    status: { condition: { truth: 'false' }, triggers: [{ armed: true }] },
    definition: { condition: { kind: 'literal', value: false } },
    context,
  });
  assert.equal(
    quiet.text,
    'Waiting for its trigger — the current condition is not met',
  );
});

test('disabled and unevaluated routines say so plainly', () => {
  assert.equal(
    describeRoutineStateLine({ enabled: false, context }).text,
    'Off — it does not run',
  );
  assert.equal(
    describeRoutineStateLine({ enabled: true, context }).text,
    'No trigger evaluation received yet; waiting for a report.',
  );
  assert.equal(
    describeRoutineStateLine({
      enabled: true,
      status: {
        condition: { error: 'device zigbee2mqtt/kitchen_light is missing' },
      },
      context,
    }).text,
    'Needs attention: device zigbee2mqtt/kitchen_light is missing',
  );
});

test('no trigger evaluation has a neutral waiting-for-report sentence', () => {
  assert.equal(
    describeRoutineStateLine({
      enabled: true,
      definition: { triggers: [{ id: 'motion' }] },
      context,
    }).text,
    'No trigger evaluation received yet; waiting for a report.',
  );
});

test('legacy live status describes current rule evaluation rather than past events', () => {
  assert.equal(
    describeRoutineStateLine({
      enabled: true,
      status: { all_conditions_match: false, will_trigger: false, rules: [] },
      context,
    }).text,
    'Current rule conditions are not all met',
  );
  assert.equal(
    describeRoutineStateLine({
      enabled: true,
      status: { all_conditions_match: true, will_trigger: false, rules: [] },
      context,
    }).text,
    'Current rules match; waiting for a trigger',
  );
});

test('the last recorded outcome stays separate from live evaluation', () => {
  assert.equal(
    describeRoutineLastOutcome({
      accepted: true,
      dropped: 0,
      steps: [{ disposition: 'dispatched' }],
    }),
    'Last recorded outcome: ran, 1 step dispatched',
  );
  assert.equal(
    describeRoutineLastOutcome({ accepted: true, dropped: 0 }),
    'Last recorded outcome: ran',
  );
  assert.equal(
    describeRoutineLastOutcome({
      accepted: true,
      dropped: 2,
      steps: [{ disposition: 'dispatched' }, { disposition: 'suppressed' }],
    }),
    'Last recorded outcome: ran, 1 step dispatched, 2 dropped',
  );
  assert.equal(
    describeRoutineLastOutcome({ accepted: false }),
    'Last recorded outcome: the run was rejected',
  );
  assert.equal(describeRoutineLastOutcome(undefined), undefined);
});

test('recorded blocked attempts keep their reason and count separate from current evaluation', () => {
  assert.equal(
    describeRoutineHistoryEvidence({
      trigger_kind: 'v2_blocked',
      action_count: 0,
      blocked_reason: 'the condition was false',
      occurrence_count: 4,
    }),
    'A trigger matched, but no run was admitted: the condition was false · 4 matching attempts.',
  );
  assert.equal(
    describeRoutineHistoryEvidence(null, true),
    'No matching event is retained. Legacy v1 does not record blocked non-runs.',
  );
});

test('a recorded routine run says dispatch, not device delivery', () => {
  assert.match(
    describeRoutineHistoryEvidence({
      trigger_kind: 'v2_run',
      action_count: 2,
      v2: { last_run: { accepted: true } },
    }),
    /dispatched 2 commands\. Device delivery is not confirmed/,
  );
});

test('durations read as words', () => {
  assert.equal(formatDurationWords(45_000), '45 seconds');
  assert.equal(formatDurationWords(120_000), '2 minutes');
  assert.equal(formatDurationWords(3 * 3_600_000), '3 hours');
  assert.equal(formatDurationWords(0), '0 seconds');
});

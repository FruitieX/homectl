import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildJourneyDefinition,
  coerceValue,
  describeFreshness,
  describeJourney,
  describeSchedule,
  describeFieldValue,
  deviceFieldOptions,
  deviceRefFromKey,
  emptyJourney,
  parseTime,
  slugifyRoutineId,
  toCron,
  validateJourney,
  type JourneyContext,
  type JourneyDraft,
} from './routineJourney.ts';

const context: JourneyContext = {
  hasDevice: (key) => key === 'hue/lamp' || key === 'esphome/motion',
  hasScene: (id) => id === 'normal',
  deviceLabel: (key) => (key === 'hue/lamp' ? 'Desk lamp' : 'Hallway motion'),
  sceneLabel: (id) => (id === 'normal' ? 'Normal' : id),
  routineLabel: (id) => (id === 'evening' ? 'Evening' : id),
};

function draft(overrides: Partial<JourneyDraft> = {}): JourneyDraft {
  return {
    ...emptyJourney(),
    intent: 'change',
    deviceKey: 'hue/lamp',
    fieldPath: '/power',
    fieldKind: 'boolean',
    value: 'true',
    outcome: 'scene',
    sceneId: 'normal',
    name: 'Evening',
    ...overrides,
  };
}

test('a device key splits into an integration and device id', () => {
  assert.deepEqual(deviceRefFromKey('hue/desk_lamp'), {
    integration_id: 'hue',
    device_id: 'desk_lamp',
  });
  assert.deepEqual(deviceRefFromKey('desk_lamp'), {
    integration_id: '',
    device_id: '',
  });
});

test('device fields come from the live payload, with values and freshness', () => {
  const lamp = {
    data: {
      Controllable: {
        state: { power: true, brightness: 0.4 },
        requested_at_ms: 1_700_000_000_000,
        last_report: { reported_at_ms: 1_700_000_600_000 },
      },
    },
  } as never;
  const options = deviceFieldOptions(lamp);
  assert.deepEqual(
    options.map((option) => option.path),
    ['/power', '/brightness'],
  );
  assert.equal(options[0].kind, 'boolean');
  assert.equal(options[1].kind, 'number');
  assert.equal(options[0].updatedAt, 1_700_000_600_000);
  assert.equal(describeFieldValue(options[0]), 'On');
  assert.equal(describeFieldValue(options[1]), '0.4');

  const motion = { data: { Sensor: { value: true } } } as never;
  assert.deepEqual(
    deviceFieldOptions(motion).map((option) => option.path),
    ['/value'],
  );
  assert.equal(deviceFieldOptions(motion)[0].kind, 'boolean');
  assert.equal(deviceFieldOptions(undefined).length, 0);
  assert.equal(describeFieldValue(undefined), null);

  assert.equal(
    describeFreshness(1_700_000_000_000, 1_700_000_030_000),
    '30s ago',
  );
  assert.equal(
    describeFreshness(1_700_000_000_000, 1_700_000_600_000),
    '10 min ago',
  );
  assert.equal(
    describeFreshness(1_700_000_000_000, 1_700_007_200_000),
    '2 h ago',
  );
  assert.equal(describeFreshness(undefined, Date.now()), null);
});

test('time parsing rejects nonsense instead of guessing', () => {
  assert.deepEqual(parseTime('07:30'), { hour: 7, minute: 30 });
  assert.deepEqual(parseTime('7:05'), { hour: 7, minute: 5 });
  assert.equal(parseTime('24:00'), null);
  assert.equal(parseTime('7:5'), null);
  assert.equal(parseTime('evening'), null);
  assert.equal(parseTime(''), null);
});

test('cron is derived from a local time and weekday choice', () => {
  assert.equal(toCron('18:00', [0, 1, 2, 3, 4, 5, 6]), '0 0 18 * * *');
  assert.equal(toCron('07:30', [1, 2, 3, 4, 5]), '0 30 7 * * 1-5');
  assert.equal(toCron('09:00', [0, 6]), '0 0 9 * * 0,6');
  assert.equal(toCron('09:00', [1, 3, 5]), '0 0 9 * * 1,3,5');
  assert.equal(toCron('09:00', [1, 2, 3, 5]), '0 0 9 * * 1-3,5');
  assert.equal(toCron('nonsense', [1]), null);
  assert.equal(
    describeSchedule('07:30', [1, 2, 3, 4, 5]),
    'Every weekday at 07:30',
  );
  assert.equal(
    describeSchedule('09:00', [0, 1, 2, 3, 4, 5, 6]),
    'Every day at 09:00',
  );
  assert.equal(describeSchedule('09:00', [1, 3]), 'Mon, Wed at 09:00');
  assert.match(describeSchedule('09:00', []), /would never run/);
});

test('the definition follows the chosen intent', () => {
  const stateChange = buildJourneyDefinition(draft()) as never as {
    triggers: unknown[];
    condition: Record<string, unknown>;
  };
  assert.deepEqual(stateChange.triggers, [
    {
      kind: 'state_change',
      id: 'state_change_1',
      device: { integration_id: 'hue', device_id: 'lamp' },
      mode: 'transition',
    },
  ]);
  assert.equal(stateChange.condition.kind, 'comparison');
  assert.equal(stateChange.condition.value, true);

  const scheduled = buildJourneyDefinition(
    draft({ intent: 'schedule', time: '07:30', days: [1, 2, 3, 4, 5] }),
  ) as never as { triggers: { kind: string; schedule: { cron: string } }[] };
  assert.equal(scheduled.triggers[0].kind, 'schedule');
  assert.equal(scheduled.triggers[0].schedule.cron, '0 30 7 * * 1-5');

  const manual = buildJourneyDefinition(
    draft({ intent: 'manual' }),
  ) as never as {
    triggers: { kind: string }[];
    condition: { kind: string };
  };
  assert.equal(manual.triggers[0].kind, 'manual');
  assert.equal(manual.condition.kind, 'literal');
});

test('“stays this way for” becomes a predicate_for trigger body', () => {
  const definition = buildJourneyDefinition(
    draft({ forMinutes: '10' }),
  ) as never as { condition: { kind: string; duration_ms: bigint } };
  assert.equal(definition.condition.kind, 'predicate_for');
  assert.equal(definition.condition.duration_ms, 600_000n);
});

test('the outcome becomes a scene activation or a power step', () => {
  const scene = buildJourneyDefinition(draft()) as never as {
    program: {
      steps: { action: string; scene_id: string; targets: unknown }[];
    };
  };
  assert.equal(scene.program.steps[0].action, 'activate_scene');
  assert.equal(scene.program.steps[0].scene_id, 'normal');
  assert.deepEqual(scene.program.steps[0].targets, {});

  const targets = buildJourneyDefinition(
    draft({ actionDeviceKey: 'hue/lamp' }),
  ) as never as { program: { steps: { targets: unknown }[] } };
  assert.deepEqual(targets.program.steps[0].targets, {
    devices: { 'hue/lamp': true },
  });

  const power = buildJourneyDefinition(
    draft({ outcome: 'power_off', actionDeviceKey: 'hue/lamp' }),
  ) as never as { program: { steps: { action: string; power: boolean }[] } };
  assert.equal(power.program.steps[0].action, 'set_power');
  assert.equal(power.program.steps[0].power, false);
});

test('values are coerced to the field kind', () => {
  assert.equal(coerceValue(draft({ value: 'true' })), true);
  assert.equal(
    coerceValue(draft({ fieldKind: 'number', value: '21.5' })),
    21.5,
  );
  assert.equal(
    coerceValue(draft({ fieldKind: 'string', value: 'home' })),
    'home',
  );
  assert.equal(
    coerceValue(draft({ fieldKind: 'number', value: 'abc' })),
    'abc',
  );
});

test('validation names each missing piece', () => {
  assert.deepEqual(validateJourney(draft(), context), []);
  assert.deepEqual(validateJourney(draft({ deviceKey: '' }), context), [
    'Choose the device the trigger watches.',
  ]);
  assert.deepEqual(validateJourney(draft({ fieldPath: '' }), context), [
    'Choose which value on that device the trigger watches.',
  ]);
  assert.deepEqual(
    validateJourney(draft({ deviceKey: 'hue/ghost' }), context),
    ['Choose the device the trigger watches.'],
  );
  assert.deepEqual(validateJourney(draft({ sceneId: '' }), context), [
    'Choose which scene the routine should activate.',
  ]);
  assert.deepEqual(validateJourney(draft({ sceneId: 'ghost' }), context), [
    'The scene “ghost” no longer exists; choose another.',
  ]);
  assert.deepEqual(validateJourney(draft({ outcome: 'none' }), context), [
    'Choose what should happen: a scene or a device action.',
  ]);
  assert.deepEqual(
    validateJourney(draft({ intent: 'schedule', days: [] }), context),
    ['Pick at least one day, or the schedule would never run.'],
  );
  assert.deepEqual(
    validateJourney(draft({ intent: 'schedule', time: '25:00' }), context),
    ['Pick a valid time of day for the schedule.'],
  );
  assert.deepEqual(
    validateJourney(draft({ fieldKind: 'number', value: '' }), context),
    ['Enter the number the trigger compares against.'],
  );
  assert.deepEqual(validateJourney(draft({ forMinutes: '0' }), context), [
    '“Stays this way for” needs a positive number of minutes.',
  ]);
  assert.deepEqual(validateJourney(draft({ name: '  ' }), context), [
    'Give the routine a name.',
  ]);
  // Any-change triggers do not need an expected value.
  assert.deepEqual(
    validateJourney(draft({ anyValue: true, value: '' }), context),
    [],
  );
});

test('the review sentence reads like a sentence', () => {
  assert.equal(
    describeJourney(draft(), context),
    'When Desk lamp is on, activate “Normal” on the scene’s own targets.',
  );
  assert.match(
    describeJourney(draft({ deviceKey: '' }), context),
    /no device chosen yet/,
  );
  assert.match(
    describeJourney(
      draft({ intent: 'schedule', time: '07:30', days: [1, 2, 3, 4, 5] }),
      context,
    ),
    /Every weekday at 07:30, activate “Normal”/,
  );
  assert.match(
    describeJourney(
      draft({
        intent: 'manual',
        outcome: 'power_off',
        actionDeviceKey: 'hue/lamp',
      }),
      context,
    ),
    /When you run it by hand, turn Desk lamp off\./,
  );
  assert.match(
    describeJourney(
      draft({ anyValue: true, fieldPath: '/value', forMinutes: '5' }),
      context,
    ),
    /reports any change to value for 5 minutes/,
  );
});

test('nothing is preselected until a card is chosen', () => {
  const blank = emptyJourney();
  assert.equal(blank.intent, '');
  assert.equal(blank.enabled, true);
  assert.deepEqual(validateJourney(blank, context), [
    'Choose what should start the routine.',
  ]);
  assert.match(describeJourney(blank, context), /Nothing chosen yet/);
});

test('copying an existing routine reuses its definition', () => {
  const copying = draft({ intent: 'copy', copyFromId: 'evening' });
  assert.deepEqual(
    validateJourney(copying, context, (id) => id === 'evening'),
    [],
  );
  assert.deepEqual(
    validateJourney(draft({ intent: 'copy', copyFromId: '' }), context),
    ['Choose the routine to copy.'],
  );
  assert.deepEqual(
    validateJourney(
      draft({ intent: 'copy', copyFromId: 'ghost' }),
      context,
      (id) => id === 'evening',
    ),
    ['The routine you chose no longer exists; choose another.'],
  );
  assert.match(describeJourney(copying, context), /Copies “Evening”/);
  // The definition is not composed by the journey: the copy is verbatim.
  const definition = buildJourneyDefinition(copying) as never as {
    triggers: unknown[];
    program: { steps: unknown[] };
  };
  assert.deepEqual(definition.triggers, []);
  assert.deepEqual(definition.program.steps, []);
});

test('ids are slugged for the config key', () => {
  assert.equal(slugifyRoutineId('Evening lights!'), 'evening-lights');
  assert.equal(slugifyRoutineId('   '), 'routine');
});

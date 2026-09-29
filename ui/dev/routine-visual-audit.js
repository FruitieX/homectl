(async () => {
  const response = await fetch('/api/v1/config/routines');
  if (
    location.origin !== 'http://127.0.0.1:3021' ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Isolated fixture required');
  const rows = (await response.json()).data;
  const existing = rows.find((row) => row.id === 'visual_complex');
  const row = structuredClone(rows.find((row) => row.id === 'motion_on'));
  const device = {
    integration_id: 'zigbee2mqtt',
    device_id: 'living_room_motion',
  };
  const motion = {
    kind: 'comparison',
    source: { kind: 'device', device, path: '/value' },
    operator: 'eq',
    value: true,
  };
  Object.assign(row, {
    id: 'visual_complex',
    name: 'Living room motion & timeout',
    enabled: false,
  });
  row.definition_v2 = {
    triggers: [
      { id: 'motion', kind: 'state_change', device, mode: 'transition' },
      { id: 'idle_finished', kind: 'timer_fired', timer: 'room_idle' },
    ],
    condition: {
      kind: 'not',
      condition: {
        kind: 'comparison',
        source: { kind: 'helper', helper: 'entryway_cooldown' },
        operator: 'eq',
        value: true,
      },
    },
    program: {
      kind: 'native',
      steps: [
        {
          id: 'motion_or_timeout',
          action: 'choose',
          branches: [
            {
              id: 'motion_detected',
              condition: {
                kind: 'all',
                conditions: [
                  motion,
                  {
                    kind: 'any',
                    conditions: [
                      {
                        kind: 'group',
                        group_id: 'living_room',
                        quantifier: 'any',
                        power: false,
                      },
                      {
                        kind: 'comparison',
                        source: { kind: 'helper', helper: 'home_mode' },
                        operator: 'eq',
                        value: 'Night',
                      },
                    ],
                  },
                ],
              },
              steps: [
                {
                  id: 'evening_glow',
                  action: 'activate_scene',
                  scene_id: 'normal',
                  targets: { groups: ['living_room'] },
                  use_scene_transition: true,
                },
                {
                  id: 'restart_idle',
                  action: 'replace_timer',
                  timer: 'room_idle',
                  delay_ms: 120000,
                },
              ],
            },
            {
              id: 'motion_clear',
              condition: { ...motion, value: false },
              steps: [
                {
                  id: 'lights_off',
                  action: 'activate_scene',
                  scene_id: 'night',
                  targets: { groups: ['living_room'] },
                  use_scene_transition: true,
                },
              ],
            },
          ],
        },
      ],
    },
    execution: { mode: 'queued', max_actions: 32 },
  };
  delete row.revision_token;
  const saved = await fetch(
    '/api/v1/config/routines' + (existing ? '/visual_complex' : ''),
    {
      method: existing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, expected: existing }),
    },
  );
  if (!saved.ok) throw Error(await saved.text());
  history.pushState({}, '', '/config/routines/visual_complex');
  dispatchEvent(new PopStateEvent('popstate'));
  for (let i = 0; i < 100; i++) {
    if (document.querySelector('[data-node-id="restart_idle"]')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const lanes = ['when', 'only-if', 'then'].map((id) => {
    const b = document.getElementById(id).getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width };
  });
  const checks = [];
  const assert = (value, message) => {
    if (!value) throw Error(message);
    checks.push(message);
  };
  assert(
    innerWidth >= 1200
      ? lanes[0].x < lanes[1].x && lanes[1].x < lanes[2].x
      : lanes[0].y < lanes[1].y && lanes[1].y < lanes[2].y,
    'Routine flow follows approved desktop/phone arrangement',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'Complex flow fits the viewport',
  );
  assert(
    document.querySelectorAll('.flow-branch').length === 2,
    'Both complex branches render',
  );
  assert(
    !!document.querySelector('[aria-label="Move restart_idle up"]'),
    'Action reordering stays visible',
  );
  assert(
    getComputedStyle(
      document.querySelector('.routine-flow'),
    ).backgroundImage.includes('radial-gradient'),
    'Dotted canvas is restored',
  );
  assert(
    !!document.querySelector(
      '[data-node-id="evening_glow"] a[href*="/config/scenes/normal"]',
    ),
    'Scene action links to its details',
  );
  for (const row of document.querySelectorAll('.condition-comparison')) {
    const operator = row.querySelector('[aria-label="Comparison operator"]');
    const value = row.querySelector('[aria-label="Expected value"]');
    if (!operator || !value) continue;
    const a = operator.getBoundingClientRect(),
      b = value.getBoundingClientRect();
    if (b.x > a.x + 20 && Math.abs(a.y - b.y) > 2)
      throw Error(`Comparison controls are misaligned: ${a.y} / ${b.y}`);
  }
  checks.push('Side-by-side comparison controls align vertically');
  document.querySelector('.routine-flow').scrollIntoView({ block: 'start' });
  return { passed: true, checks, lanes, width: innerWidth };
})();

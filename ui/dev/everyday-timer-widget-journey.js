(async () => {
  const base = '/api/v1/config',
    marker = await fetch(base + '/timers');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Isolated fixture required');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 120));
  const until = async (fn, m) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(m);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const write = async (path, body, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).data;
  };
  const current = (await marker.json()).data;
  const id = crypto.randomUUID();
  const name = 'Reading lamp';
  const d = {
    id,
    name,
    icon: 'light',
    enabled: false,
    schedule: { kind: 'countdown', minutes: 20 },
    action: {
      kind: 'device',
      device_key: 'zigbee2mqtt/living_room_lamp',
      power: false,
    },
    finish_action: null,
  };
  await write(
    '/timers',
    {
      timers: [...current.timers.map((t) => t.definition), d],
      expected: current.timers.map((t) => t.definition),
    },
    'PUT',
  );
  const layout = await write('/dashboard/layouts', {
    id: 0,
    name: 'Timer verification',
    is_default: false,
  });
  for (const [index, ids] of [[id], []].entries())
    await write('/dashboard/widgets', {
      id: 0,
      layout_id: layout.id,
      widget_type: 'timers',
      config: {
        title: index ? 'Empty timer selection' : 'Evening timers',
        options: { timerSelection: 'selected', timerIds: ids },
      },
      grid_x: index * 4,
      grid_y: 0,
      grid_w: 4,
      grid_h: 3,
      sort_order: index,
    });
  history.pushState({}, '', '/groups');
  dispatchEvent(new PopStateEvent('popstate'));
  await pause();
  history.pushState({}, '', '/?layout=' + layout.id);
  dispatchEvent(new PopStateEvent('popstate'));
  await until(
    () => document.querySelector('[aria-label="Start Reading lamp"]'),
    'Timer widget renders',
  );
  assert(
    document.body.textContent.includes('No timers selected'),
    'Empty selected scope stays empty',
  );
  assert(
    document.querySelectorAll('a').length &&
      [...document.querySelectorAll('a')].some(
        (a) => a.textContent === name && a.getAttribute('href').includes(id),
      ),
    'Widget links to the selected timer',
  );
  document.querySelector('[aria-label="Start Reading lamp"]').click();
  await until(
    () => document.querySelector('[aria-label="Stop Reading lamp"]'),
    'Countdown armed',
  );
  const read = async () =>
    (await (await fetch(base + '/timers')).json()).data.timers.find(
      (t) => t.definition.id === id,
    );
  assert(
    (await read()).definition.enabled &&
      (await read()).runtime.next_start_ms > Date.now(),
    'Start arms a server countdown',
  );
  document.querySelector('[aria-label="Stop Reading lamp"]').click();
  await until(
    () => document.querySelector('[aria-label="Start Reading lamp"]'),
    'Countdown cancelled',
  );
  assert(
    !(await read()).definition.enabled,
    'Stop updates the canonical schedule',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal overflow',
  );
  return { checks, width: innerWidth, layout: layout.id };
})();

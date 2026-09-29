(async () => {
  const base = '/api/v1/config';
  const marker = await fetch(base + '/dashboard/layouts');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use isolated fixture on 3021.');
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, message) => {
    for (let i = 0; i < 150; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
    checks.push(message);
  };
  const write = async (path, value, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).data;
  };
  const goto = async (path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    await pause();
  };
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const catalog = (await (await fetch(base + '/sensors/catalog')).json()).data;
  await write(
    '/sensors/catalog',
    {
      expected: catalog,
      sensors: [
        {
          id: 'render_living',
          name: 'Living climate',
          source: 'influxdb',
          enabled: true,
        },
      ],
      groups: [],
    },
    'PUT',
  );
  const layout = await write('/dashboard/layouts', {
    id: 0,
    name: 'Everyday verification',
    is_default: false,
  });
  const definitions = [
    [
      'rooms',
      'Rooms',
      {
        roomSelection: 'selected',
        groupIds: ['living_room'],
        showPower: true,
        showAttention: true,
      },
    ],
    [
      'scenes',
      'Scenes',
      {
        sceneSelection: 'selected',
        sceneIds: ['normal', 'night'],
        scope: 'group',
        groupId: 'living_room',
      },
    ],
    [
      'indoor_climate',
      'Indoor climate',
      {
        temperatureSensorId: 'render_living',
        humiditySensorId: '',
        range: '-24h',
      },
    ],
  ];
  const widgets = [];
  for (const [index, [widget_type, title, options]] of definitions.entries())
    widgets.push(
      await write('/dashboard/widgets', {
        id: 0,
        layout_id: layout.id,
        widget_type,
        config: { title, options },
        grid_x: (index % 2) * 4,
        grid_y: Math.floor(index / 2) * 4,
        grid_w: 4,
        grid_h: 4,
        sort_order: index,
      }),
    );
  await goto('/groups');
  await goto('/?layout=' + layout.id);
  await until(
    () => document.body.textContent.includes('Living climate'),
    'Climate widget renders',
  );
  assert(
    document.body.textContent.includes('21.0'),
    'Actual temperature displayed',
  );
  assert(
    document.body.textContent.includes('Living room'),
    'Selected room rendered',
  );
  assert(
    document.body.textContent.includes('Activation scope: Living room'),
    'Scenes show explicit scope',
  );
  assert(
    !document.body.textContent.includes('Unknown widget'),
    'All three types recognized',
  );
  document.querySelector('[aria-label="Open Indoor climate details"]').click();
  await until(
    () => document.querySelector('[role="dialog"]'),
    'Climate details opened',
  );
  assert(
    document
      .querySelector('[role="dialog"]')
      .textContent.includes('Humidity updated: No readings'),
    'Absent humidity is not invented',
  );
  document.querySelector('[role="dialog"] button[aria-label="Close"]')?.click();
  if (document.querySelector('[role="dialog"]'))
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  await pause();
  await goto(`/config/dashboard/${layout.id}/widgets/${widgets[0].id}`);
  await until(
    () => document.querySelector('[aria-label="Rooms shown"]'),
    'Room widget editor loaded',
  );
  assert(
    document.querySelector('[aria-label="Rooms shown"]').value === 'selected',
    'Room selection survives API round trip',
  );
  input(document.querySelector('[aria-label="Rooms shown"]'), 'all');
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Room options saved');
  const rows = (
    await (await fetch(base + `/dashboard/layouts/${layout.id}/widgets`)).json()
  ).data;
  assert(
    rows.find((row) => row.id === widgets[0].id).config.options
      .roomSelection === 'all',
    'Editor persists changes through dashboard API',
  );
  await goto(`/config/dashboard/${layout.id}/widgets/${widgets[1].id}`);
  await until(
    () => document.querySelector('[aria-label="Activation scope"]'),
    'Scene widget editor loaded',
  );
  input(document.querySelector('[aria-label="Activation scope"]'), 'devices');
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Empty scope saved');
  await goto('/?layout=' + layout.id);
  await until(
    () =>
      document.body.textContent.includes(
        'Activation scope: 0 selected devices',
      ),
    'Empty scope rendered',
  );
  assert(
    ![...document.querySelectorAll('button')].some(
      (el) =>
        /^Activate /.test(el.getAttribute('aria-label') || '') && !el.disabled,
    ),
    'Empty scope cannot activate devices outside selection',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal page overflow',
  );
  return {
    passed: true,
    checks,
    layout: layout.id,
    widgets: widgets.map((w) => w.id),
  };
})();

(async () => {
  const marker = await fetch('/api/v1/config/scenes');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use isolated fixture.');
  const before = (await marker.json()).data;
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 120));
  const until = async (fn, msg) => {
    for (let i = 0; i < 150; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(msg);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const button = (t) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === t,
    );
  await until(
    () => document.querySelector('[aria-label="Adjust Living room lamp"]'),
    'Room ready',
  );
  document.querySelector('[aria-label="Adjust Living room lamp"]').click();
  await until(() => button('Capture scene'), 'Shared controls ready');
  assert(
    document.querySelectorAll('[role="dialog"] [aria-label="Brightness"]')
      .length === 1,
    'One brightness control in the shared sheet',
  );
  assert(
    document.querySelector('[role="dialog"]').textContent.includes('Scenes'),
    'Scenes visible without a section tab',
  );
  button('Capture scene').click();
  await until(
    () => document.querySelector('#capture-scene-name'),
    'Capture review ready',
  );
  const input = document.querySelector('#capture-scene-name');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
    input,
    'Captured room test',
  );
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
  button('Review scene').click();
  await until(
    () =>
      location.pathname === '/config/scenes/new' &&
      document.querySelector('[data-field="name"]'),
    'Canonical editor opened',
  );
  assert(
    document.querySelector('[data-field="name"]').value ===
      'Captured room test',
    'Capture name transferred',
  );
  assert(
    document.body.textContent.includes('Captured requested states'),
    'Requested state provenance shown',
  );
  assert(
    document.body.textContent.includes('Living room lamp'),
    'Stable device target resolves in canonical editor',
  );
  const unsaved = (await (await fetch('/api/v1/config/scenes')).json()).data;
  assert(unsaved.length === before.length, 'Review does not persist a scene');
  document.querySelector('a[href="/groups/living_room"]').click();
  await until(
    () => location.pathname === '/groups/living_room',
    'Return to controls',
  );
  history.back();
  await until(
    () => document.querySelector('[data-field="name"]'),
    'Draft restored',
  );
  assert(
    document.querySelector('[data-field="name"]').value ===
      'Captured room test',
    'Unsaved capture retained across navigation',
  );
  const create = button('Create scene');
  assert(Boolean(create), 'Explicit Create scene action');
  create.click();
  await until(
    () =>
      location.pathname.startsWith('/config/scenes/') &&
      location.pathname !== '/config/scenes/new',
    'Scene created',
  );
  const saved = (await (await fetch('/api/v1/config/scenes')).json()).data.find(
    (s) => s.name === 'Captured room test',
  );
  assert(Boolean(saved), 'Scene persisted after explicit creation');
  assert(
    Boolean(saved.device_states['zigbee2mqtt/living_room_lamp']),
    'Capture uses stable device identity',
  );
  assert(
    saved.device_states['zigbee2mqtt/living_room_lamp'].color.h === 32,
    'Original HS color preserved',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal overflow',
  );
  return { passed: true, checks, scene: saved };
})();

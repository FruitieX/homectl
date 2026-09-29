(async () => {
  const marker = await fetch('/api/v1/config/groups');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Isolated fixture required');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 120));
  const until = async (fn, m) => {
    for (let i = 0; i < 120; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(m);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const goto = async (path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    await pause();
  };
  const button = (t) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === t,
    );
  await goto('/groups/everyday_parent');
  await until(
    () => document.querySelector('h1')?.textContent === 'Upstairs',
    'Nested room loaded',
  );
  assert(
    document.querySelectorAll('[aria-label="Adjust Living room lamp"]')
      .length === 1,
    'Nested and direct membership deduplicated',
  );
  assert(
    document.body.textContent.includes('1 unavailable') &&
      document.body.textContent.includes('dummy/missing_light'),
    'Missing member stays visible',
  );
  assert(
    !document.querySelector('a[aria-label="Open Upstairs floorplan"]'),
    'No floorplan preview without placements',
  );
  const readonly = document.querySelector('[aria-label="Turn Floor lamp on"]');
  assert(readonly?.disabled, 'Read-only power control disabled');
  document.querySelector('[aria-label="Adjust Floor lamp"]').click();
  await until(
    () => document.querySelector('[role="dialog"]'),
    'Read-only detail',
  );
  assert(
    document.querySelector('[role="dialog"]').textContent.includes('read-only'),
    'Read-only detail explains unavailable controls',
  );
  document.querySelector('[role="dialog"] button[aria-label="Close"]').click();
  await until(
    () => !document.querySelector('[role="dialog"]'),
    'Closed controls',
  );
  const sensor = document.querySelector(
    '[aria-label="Open Living room motion sensor details"]',
  );
  assert(!!sensor, 'Nested sensor row visible');
  sensor.click();
  await until(() => document.querySelector('[role="dialog"]'), 'Sensor opened');
  assert(
    !![...document.querySelectorAll('[role="dialog"] a')].find(
      (a) =>
        a.getAttribute('href') ===
        '/config/devices/detail/zigbee2mqtt/living_room_motion',
    ),
    'Sensor canonical detail link',
  );
  document.querySelector('[role="dialog"] button[aria-label="Close"]').click();
  await until(
    () => !document.querySelector('[role="dialog"]'),
    'Sensor closed',
  );
  await goto('/groups/everyday_empty');
  await until(
    () => document.body.textContent.includes('No devices in this room yet'),
    'Empty room',
  );
  assert(
    !button('Adjust together'),
    'Empty room offers no broad control command',
  );
  await goto('/groups/missing-room');
  await until(
    () => document.body.textContent.includes('Room not found'),
    'Missing room',
  );
  assert(
    document.querySelector('a[href="/groups"]') !== null,
    'Missing room recovery destination',
  );
  await goto('/this-route-does-not-exist');
  await until(
    () => document.body.textContent.includes('Page not found'),
    'Not found route',
  );
  assert(
    location.pathname === '/this-route-does-not-exist',
    'Unknown URL is not silently redirected',
  );
  await goto('/groups/everyday_parent');
  await until(
    () => document.querySelector('h1')?.textContent === 'Upstairs',
    'Room restored',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal overflow',
  );
  return { checks, width: innerWidth };
})();

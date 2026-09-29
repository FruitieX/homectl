(async () => {
  const endpoint = '/api/v1/config/sensors/catalog';
  const marker = await fetch(endpoint);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [],
    pause = () => new Promise((resolve) => setTimeout(resolve, 150));
  const until = async (predicate, message) => {
    for (let i = 0; i < 80; i++) {
      if (predicate()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
    checks.push(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const field = (name) => document.querySelector(`[aria-label="${name}"]`);
  const input = (el, value) => {
    if (!el) throw Error('Missing input');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const save = async () => {
    button('Save changes').click();
    await until(() => !button('Save changes'), 'Saved');
  };
  await until(() => button('Add sensor'), 'Catalog loaded');
  button('Add sensor').click();
  await pause();
  button('Save changes').click();
  await until(
    () => document.activeElement === field('Sensor 1 ID'),
    'Validation focuses the missing ID',
  );
  assert(
    Boolean(document.querySelector('[role=alert]')),
    'Invalid new sensor stays in the draft with a focused error',
  );
  input(field('Sensor 1 ID'), 'catalog_bedroom');
  input(field('Sensor 1 name'), 'Bedroom');
  button('Add sensor').click();
  await pause();
  input(field('Sensor 2 ID'), 'catalog_hall');
  input(field('Sensor 2 name'), 'Hallway');
  button('Add group').click();
  await pause();
  input(field('Group 1 name'), 'Indoor sensors');
  input(field('Group 1 ID'), 'indoor');
  await pause();
  const pick = async (name) => {
    button('Add members to Indoor sensors…').click();
    await pause();
    const option = [...document.querySelectorAll('[cmdk-item]')].find((el) =>
      el.textContent.includes(name),
    );
    if (!option) throw Error('Missing picker choice ' + name);
    option.click();
    await until(() => !document.querySelector('[cmdk-item]'), 'Picker closed');
  };
  await pick('Bedroom');
  await pick('Hallway');
  assert(
    (await saved()).sensors.length === 0,
    'Adding and naming multiple entries does not write before Save',
  );
  await save();
  let row = await saved();
  assert(
    row.sensors.length === 2 &&
      row.groups[0].sensorIds.join(',') === 'catalog_bedroom,catalog_hall',
    'One save round-trips multiple sensors and group members in order',
  );
  field('Enable Bedroom').click();
  input(field('Sensor 1 name'), 'Bedroom draft');
  await pause();
  [...document.querySelectorAll('a[href="/config/devices"]')]
    .find((el) => el.textContent.includes('Device sensors'))
    .click();
  await until(
    () => location.pathname === '/config/devices',
    'Device list opened',
  );
  await until(
    () =>
      document.querySelector(
        '[aria-label="Retained drafts"] a[href="/config/sensors"]',
      ),
    'Retained catalog link',
  );
  document
    .querySelector('[aria-label="Retained drafts"] a[href="/config/sensors"]')
    .click();
  await until(
    () => field('Sensor 1 name')?.value === 'Bedroom draft',
    'Catalog draft returned',
  );
  assert(
    !field('Enable Bedroom draft').checked &&
      (await saved()).sensors[0].enabled,
    'Related navigation keeps both draft fields without saving',
  );
  const remote = {
    ...row,
    futureCatalog: { preserve: true },
    sensors: row.sensors.map((sensor, index) =>
      index ? { ...sensor, name: 'Hallway remote', future: [1, null] } : sensor,
    ),
  };
  await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...remote, expected: row }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Stale catalog rejected');
  button('Review changes').click();
  await until(() => button('Use reviewed choices'), 'Review opened');
  assert(
    field('Sensor 1 name').value === 'Bedroom draft',
    'A rejected save retains the pending catalog draft',
  );
  button('Use latest saved').click();
  await pause();
  await until(
    () => field('Sensor 2 name')?.value === 'Hallway remote',
    'Latest saved catalog loaded',
  );
  field('Enable Bedroom').click();
  input(field('Sensor 1 name'), 'Bedroom final');
  await pause();
  await save();
  row = await saved();
  assert(
    row.sensors[0].name === 'Bedroom final' &&
      !row.sensors[0].enabled &&
      row.sensors[1].future[0] === 1 &&
      row.futureCatalog.preserve,
    'Save preserves remote extensions and the explicit enabled state',
  );
  field('Remove sensor Bedroom final').click();
  await pause();
  assert(
    !document.querySelector('a[href="/config/sensors#sensor-catalog_bedroom"]'),
    'Removing a sensor removes its local group membership',
  );
  button('Discard').click();
  await pause();
  assert(
    Boolean(field('Sensor 2 name')),
    'Discard restores a removed sensor and its membership',
  );
  assert(
    ![
      ...document.querySelectorAll(
        'main input, main select, main [role=combobox]',
      ),
    ].some((el) => el.getBoundingClientRect().right > innerWidth + 1),
    'Catalog controls fit the viewport',
  );
  return { passed: true, checks };
})();

(async () => {
  const root = '/api/v1/config/integrations',
    response = await fetch(root);
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const original = (await response.json()).data.find(
    (row) => row.id === 'zigbee2mqtt',
  );
  const checks = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
  const until = async (predicate, message) => {
    for (let i = 0; i < 60; i++) {
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
  const input = (el, value) => {
    if (!el) throw Error('Missing input');
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
  const saved = async () =>
    (await (await fetch(root)).json()).data.find(
      (row) => row.id === 'zigbee2mqtt',
    );
  await until(
    () => document.querySelector('input[aria-label="Host"]'),
    'Integration editor ready',
  );
  assert(
    !Object.hasOwn(original.config, 'password') &&
      original.secret_fields.includes('password'),
    'API omits the stored password and reports its presence',
  );
  assert(
    document.querySelector('input[type=password]').value === '',
    'Stored credentials are not put into an input',
  );
  input(
    document.querySelector('input[aria-label="Host"]'),
    'draft-broker.local',
  );
  await pause();
  const field = () =>
    document.querySelector('[data-field="config.sensor_value_fields"]');
  const add = () =>
    [...field().querySelectorAll('button')].find(
      (el) => el.textContent.trim() === 'Add entry',
    );
  add().click();
  await pause();
  add().click();
  await pause();
  const pathInputs = field().querySelectorAll('input');
  input(pathInputs[pathInputs.length - 2], '/temperature');
  input(pathInputs[pathInputs.length - 1], '/humidity');
  await pause();
  assert(
    field().querySelectorAll('input').length >= 2,
    'Sensor mappings accept multiple entries',
  );
  const deviceLink = document.querySelector(
    '#devices a[href*="/devices/detail/"]',
  );
  assert(
    Boolean(deviceLink),
    'Integration devices link directly to their settings',
  );
  deviceLink.click();
  await until(
    () => location.pathname.includes('/devices/detail/'),
    'Device opened',
  );
  await until(
    () => document.querySelector('[aria-label="Retained drafts"] a'),
    'Draft return appears',
  );
  [...document.querySelectorAll('[aria-label="Retained drafts"] a')]
    .find((el) => el.href.includes('/integrations/zigbee2mqtt'))
    .click();
  await until(
    () => document.querySelector('input[aria-label="Host"]'),
    'Integration draft returned',
  );
  assert(
    document.querySelector('input[aria-label="Host"]').value ===
      'draft-broker.local',
    'Integration draft survives related navigation',
  );
  assert(
    (await saved()).config.host === original.config.host,
    'Related navigation does not reload or save an integration',
  );
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Integration saved');
  let current = await saved();
  assert(
    current.config.host === 'draft-broker.local' &&
      current.config.sensor_value_fields.slice(-2).join(',') ===
        '/temperature,/humidity',
    'One save preserves the entire sensor mapping collection',
  );
  assert(
    current.secret_fields.includes('password') &&
      !Object.hasOwn(current.config, 'password'),
    'An unrelated save keeps the stored password without returning it',
  );
  input(
    document.querySelector('input[aria-label="Host"]'),
    'My concurrent edit',
  );
  await pause();
  await fetch(root + '/zigbee2mqtt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...current,
      config: { ...current.config, port: 1884 },
      expected: current,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict appears');
  button('Review changes').click();
  await until(
    () => document.querySelector('[role=dialog]'),
    'Conflict review opened',
  );
  assert(
    document.querySelector('[role=dialog]').innerText.includes('config / host'),
    'Conflict review identifies the edited nested field',
  );
  button('Use reviewed choices').click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Reviewed save done');
  current = await saved();
  assert(
    current.config.port === 1884 &&
      current.config.host === 'My concurrent edit',
    'Reviewed save keeps a remotely changed sibling field',
  );
  input(document.querySelector('input[type=password]'), 'replacement-secret');
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Replacement saved');
  assert(
    document.querySelector('input[type=password]').value === '',
    'Password replacement is removed from the saved browser draft',
  );
  assert(
    ![...document.querySelectorAll('main input,main select')].some(
      (el) => el.getBoundingClientRect().right > innerWidth + 1,
    ),
    'Integration controls fit the viewport',
  );
  current = await saved();
  await fetch(root + '/zigbee2mqtt', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...original, expected: current }),
  });
  return { passed: true, checks };
})();

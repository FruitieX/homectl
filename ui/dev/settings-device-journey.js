(async () => {
  const key = 'zigbee2mqtt/bedroom_switch',
    url =
      '/api/v1/config/device-settings?device_key=' + encodeURIComponent(key);
  const marker = await fetch(url);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated development fixture on port 3021.');
  const original = (await marker.json()).data;
  const results = [];
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
    results.push(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () => (await (await fetch(url)).json()).data;
  await until(
    () => document.querySelector('[data-field="display_name"]'),
    'Device editor loaded',
  );
  assert(
    !button('Edit'),
    'Ordinary settings are editable without an Edit action',
  );
  input(
    document.querySelector('[data-field="display_name"]'),
    'Bedroom switch draft',
  );
  await until(() => button('Save changes'), 'Save bar appears');
  const integration = document.querySelector('#details a');
  assert(
    integration?.href.includes('/config/integrations/zigbee2mqtt'),
    'Integration details are linked from the device',
  );
  integration.click();
  await until(
    () => location.pathname === '/config/integrations/zigbee2mqtt',
    'Integration opened',
  );
  await until(
    () => document.querySelector('[aria-label="Retained drafts"] a'),
    'Retained draft link appears',
  );
  document.querySelector('[aria-label="Retained drafts"] a').click();
  await until(
    () => document.querySelector('[data-field="display_name"]'),
    'Device draft restored',
  );
  assert(
    document.querySelector('[data-field="display_name"]').value ===
      'Bedroom switch draft',
    'Device draft survives related navigation',
  );
  assert(
    (await saved()).display_name === original.display_name,
    'Navigation does not save settings',
  );
  const onField = [...document.querySelectorAll('#details label')]
    .find((el) => el.textContent.trim().startsWith('On value'))
    ?.querySelector('input');
  assert(Boolean(onField), 'Sensor mapping values are directly editable');
  input(onField, 'new_press');
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Device settings saved');
  const stored = await saved();
  assert(
    stored.display_name === 'Bedroom switch draft' &&
      stored.sensor.config.on_value === 'new_press',
    'One save updates the name and sensor mapping',
  );
  assert(
    JSON.stringify(stored.sensor.config.future) ===
      JSON.stringify(original.sensor.config.future),
    'Unknown sensor configuration survives unrelated edits',
  );
  input(document.querySelector('[data-field="display_name"]'), 'Discard this');
  await pause();
  button('Discard').click();
  await pause();
  assert(
    document.querySelector('[data-field="display_name"]').value ===
      stored.display_name,
    'Discard restores the saved device settings',
  );
  input(
    document.querySelector('[data-field="display_name"]'),
    'My stale draft',
  );
  await pause();
  await fetch('/api/v1/config/device-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...stored,
      display_name: 'Changed elsewhere',
      expected: stored,
    }),
  });
  button('Save changes').click();
  await until(
    () => document.body.innerText.includes('changed elsewhere'),
    'Conflict shown',
  );
  assert(
    document.querySelector('[data-field="display_name"]').value ===
      'My stale draft',
    'Concurrent saves retain the pending draft',
  );
  button('Discard').click();
  await pause();
  assert(
    document.querySelector('[data-field="display_name"]').value ===
      'Changed elsewhere',
    'Discard after a conflict uses the latest saved version',
  );
  const outside = [
    ...document.querySelectorAll('#details input,#details select'),
  ].filter((el) => el.getBoundingClientRect().right > innerWidth + 1);
  assert(outside.length === 0, 'Device settings controls fit the viewport');
  await fetch('/api/v1/config/device-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...original, expected: await saved() }),
  });
  return { passed: true, results };
})();

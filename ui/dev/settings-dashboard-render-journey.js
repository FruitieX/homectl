(async () => {
  performance.setResourceTimingBufferSize(5000);
  const base = '/api/v1/config',
    marker = await fetch(base + '/dashboard/layouts');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.port !== '3021' ||
    location.hostname !== '127.0.0.1'
  )
    throw Error('Use isolated fixture.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 150)),
    until = async (fn, msg) => {
      for (let i = 0; i < 260; i++) {
        if (fn()) return;
        await pause();
      }
      throw Error(msg);
    };
  const assert = (v, msg) => {
    if (!v) throw Error(msg);
    checks.push(msg);
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
  await fetch(base + '/sensors/catalog', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected: catalog,
      sensors: [
        {
          id: 'render_living',
          name: 'Rendered living sensor',
          source: 'influxdb',
          enabled: true,
        },
        {
          id: 'render_bedroom',
          name: 'Disabled bedroom sensor',
          source: 'influxdb',
          enabled: false,
        },
      ],
      groups: [],
    }),
  });
  await until(
    () => document.querySelector('[aria-label="Sensors shown"]'),
    'Sensor widget editor loaded',
  );
  input(document.querySelector('[aria-label="Sensors shown"]'), 'all');
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'All sensors saved');
  document.querySelector('a[href="/?layout=1"]').click();
  await until(
    () =>
      document
        .querySelector('.dashboard-sensors-preview')
        ?.textContent.includes('Rendered living sensor'),
    'Dashboard sensor rendered',
  );
  assert(
    !document
      .querySelector('.dashboard-sensors-preview')
      .textContent.includes('Disabled bedroom sensor'),
    'Dashboard respects the catalog enabled flag',
  );
  assert(
    document
      .querySelector('.dashboard-sensors-preview')
      .textContent.includes('21.0°'),
    'Dashboard shows actual fixture sensor values',
  );
  assert(
    performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('temp-sensors?widget_id=1')) &&
      !performance
        .getEntriesByType('resource')
        .some((entry) => entry.name.includes('token=')),
    'Widget data requests use the widget ID without credentials in URLs',
  );
  history.back();
  await until(
    () => document.querySelector('[aria-label="Sensors shown"]'),
    'Widget editor returned',
  );
  input(document.querySelector('[aria-label="Sensors shown"]'), 'selected');
  await pause();
  for (const label of [
    'Remove living (unavailable)',
    'Remove bedroom (unavailable)',
  ]) {
    document.querySelector(`button[aria-label="${label}"]`)?.click();
    await pause();
  }
  button('Save changes').click();
  await until(() => !button('Save changes'), 'None selected saved');
  document.querySelector('a[href="/?layout=1"]').click();
  await until(
    () =>
      document
        .querySelector('.dashboard-sensors-card')
        ?.textContent.includes('No sensors selected.'),
    'Empty selection rendered',
  );
  assert(
    !document
      .querySelector('.dashboard-sensors-preview')
      .textContent.includes('Rendered living sensor'),
    'Explicitly empty selection stays empty despite catalog and live data',
  );
  return { passed: true, checks };
})();

(async () => {
  const endpoint = '/api/v1/config/dashboard',
    marker = await fetch(endpoint + '/layouts');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (fn, msg) => {
    for (let i = 0; i < 80; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(msg);
  };
  const assert = (v, msg) => {
    if (!v) throw Error(msg);
    checks.push(msg);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const field = (name) => document.querySelector(`[data-field="${name}"]`);
  const input = async (el, value) => {
    if (el.getAttribute('aria-label') === 'Widget type') {
      [...el.querySelectorAll('button')]
        .find((button) =>
          button.textContent
            .trim()
            .startsWith(value === 'text' ? 'Text' : 'Clock'),
        )
        .click();
      await pause();
      return;
    }
    if (el.tagName === 'BUTTON') {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      );
      const text =
        el.getAttribute('aria-label') === 'Sensors shown'
          ? value === 'all'
            ? 'All enabled sensors'
            : 'Selected sensors'
          : el.getAttribute('aria-label') === 'Rooms shown'
            ? value === 'all'
              ? 'All visible rooms'
              : 'Selected rooms'
            : 'Selected devices';
      const option = () =>
        [
          ...document.querySelectorAll(
            '[data-radix-select-viewport] [role=option]',
          ),
        ].find((e) => e.textContent.trim() === text);
      await until(option, 'Shared selector opened');
      option().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      await until(
        () => !document.querySelector('[data-radix-select-viewport]'),
        'Shared selector closed',
      );
      return;
    }
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
    (await (await fetch(endpoint + '/layouts/1/widgets')).json()).data.find(
      (row) => row.id === 1,
    );
  const save = async () => {
    button('Save changes').click();
    await until(() => !button('Save changes'), 'Saved');
  };
  await until(() => field('influxToken'), 'Widget loaded');
  assert(
    field('influxToken').value === '' &&
      (await saved()).secret_fields.includes('influxToken'),
    'Widget token is masked and represented by presence',
  );
  await input(field('title'), 'Reviewed sensors');
  await input(field('influxToken'), 'pending-widget-token');
  await input(document.querySelector('[aria-label="Sensors shown"]'), 'all');
  await pause();
  await input(
    document.querySelector('[aria-label="Sensors shown"]'),
    'selected',
  );
  await pause();
  assert(
    document.querySelector(
      'button[aria-label="Remove living (unavailable)"]',
    ) &&
      document.querySelector(
        'button[aria-label="Remove bedroom (unavailable)"]',
      ),
    'Switching sensor mode retains selected IDs, including unavailable sensors',
  );
  document
    .querySelector('button[aria-label="Remove living (unavailable)"]')
    .click();
  await pause();
  document
    .querySelector('button[aria-label="Remove bedroom (unavailable)"]')
    .click();
  await pause();
  document.querySelector('a[href="/config/widget-sources/influxdb"]').click();
  await until(
    () => document.querySelector('h1')?.textContent === 'InfluxDB',
    'Source opened',
  );
  history.back();
  await until(() => field('influxToken'), 'Widget returned');
  assert(
    field('title').value === 'Reviewed sensors' &&
      field('influxToken').value === 'pending-widget-token' &&
      document.body.innerText.includes('0 selected'),
    'Related navigation keeps all widget edits in memory',
  );
  assert(
    (await saved()).config.title === 'Indoor readings',
    'Related navigation does not save a widget',
  );
  await save();
  let row = await saved();
  assert(
    row.config.options.sensorSelection === 'selected' &&
      row.config.options.sensorIds.length === 0 &&
      row.config.options.future.keep.length === 2 &&
      field('influxToken').value === '',
    'Explicit save preserves empty selection, extensions and masks the credential',
  );
  await input(field('title'), 'Locally renamed');
  await pause();
  await fetch(endpoint + '/widgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...row,
      config: {
        ...row.config,
        options: { ...row.config.options, influxToken: 'remote-widget-token' },
      },
      expected: row.revision_token,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict detected');
  button('Review changes').click();
  await pause();
  assert(
    !document.body.innerText.includes('remote-widget-token') &&
      field('title').value === 'Locally renamed',
    'Secret-only changes reject stale widget writes without losing title edits',
  );
  button('Use reviewed choices').click();
  await pause();
  await save();
  assert(
    (await saved()).secret_fields.includes('influxToken'),
    'Review preserves the remotely saved credential',
  );
  const remove = [...document.querySelectorAll('label')]
    .find((el) => el.textContent.trim() === 'Remove override on Save')
    .querySelector('input');
  remove.click();
  await pause();
  assert(
    (await saved()).secret_fields.includes('influxToken'),
    'Removing a credential is staged until Save',
  );
  button('Discard').click();
  await pause();
  await input(field('grid_w'), '0');
  await pause();
  button('Save changes').click();
  await until(
    () => field('grid_w').getAttribute('aria-invalid') === 'true',
    'Width validation',
  );
  assert(
    document.activeElement === field('grid_w'),
    'Invalid dimensions focus the control without submitting',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Widget editor fits the viewport',
  );
  document.querySelector('a[href="/config/dashboard/1"]').click();
  await until(
    () => document.querySelector('a[href="/config/dashboard/1/widgets/new"]'),
    'Layout opened',
  );
  document.querySelector('a[href="/config/dashboard/1/widgets/new"]').click();
  await until(
    () => document.querySelector('[aria-label="Widget type"]'),
    'New widget opened',
  );
  await input(field('title'), 'Custom clock title');
  await input(document.querySelector('[aria-label="Widget type"]'), 'text');
  await pause();
  await input(document.querySelector('[aria-label="Widget type"]'), 'clock');
  await pause();
  assert(
    field('title').value === 'Custom clock title',
    'New widget type switching retains the previous type draft',
  );
  button('Create widget').click();
  await until(() => !location.pathname.endsWith('/new'), 'Widget created');
  assert(
    (await (await fetch(endpoint + '/layouts/1/widgets')).json()).data
      .length === 2,
    'Creating a widget adds exactly one entry to its layout',
  );
  return { passed: true, checks };
})();

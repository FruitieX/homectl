(async () => {
  const root = '/api/v1/config/sources',
    response = await fetch(root);
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const id = `settings_source_${innerWidth}_${Date.now()}`,
    checks = [],
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
  const computation = async (label) => {
    document
      .querySelector('[data-field=compute]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    await until(
      () => document.querySelector('[role=option]'),
      'Computation choices',
    );
    [...document.querySelectorAll('[role=option]')]
      .find((el) => el.textContent.trim() === label)
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    await pause();
  };
  const saved = async () =>
    (await (await fetch(root)).json()).data.find((row) => row.id === id);
  await fetch(`${root}/${id}`, { method: 'DELETE' });
  await until(
    () => document.querySelector('[data-field=name]'),
    'Source editor ready',
  );
  input(document.querySelector('[data-field=id]'), id);
  input(document.querySelector('[data-field=name]'), 'Evening profile');
  input(document.querySelector('[aria-label="day brightness"]'), '64');
  await pause();
  document.querySelector('[data-field="compute.params.day_color"]').click();
  await until(
    () => document.querySelector('[aria-label="Colour temperature"]'),
    'Color editor ready',
  );
  assert(
    document.querySelector('[aria-label="Colour temperature"]').value ===
      '3000',
    'Temperature editor reads the backend Kelvin value directly',
  );
  input(document.querySelector('[aria-label="Colour temperature"]'), '4200');
  button('Apply color').click();
  await pause();
  assert(
    document
      .querySelector('#profile [role=img]')
      .getAttribute('aria-label')
      .includes('4200 K'),
    'Color preview describes Kelvin without unit conversion',
  );
  button('Add alias').click();
  await pause();
  input(document.querySelector('[aria-label="Alias 1"]'), 'legacy/day');
  button('Add alias').click();
  await pause();
  input(document.querySelector('[aria-label="Alias 2"]'), 'legacy/night');
  button('Preview draft').click();
  await until(
    () => document.querySelector('[aria-label="Light profile preview"]'),
    'Fixture preview returned',
  );
  input(document.querySelector('[aria-label="day brightness"]'), '65');
  await pause();
  assert(
    document.querySelector('#preview').innerText.includes('Draft changed.'),
    'Editing inputs marks the previous preview stale',
  );
  await computation('Custom JavaScript');
  await pause();
  await computation('Built-in circadian');
  await pause();
  assert(
    document.querySelector('[aria-label="day brightness"]').value === '65',
    'Computation switching retains the previous parameters',
  );
  button('Create source').click();
  await until(
    () =>
      location.pathname.endsWith('/' + id) &&
      document.querySelector('#current'),
    'Source saved',
  );
  let row = await saved();
  assert(
    row.aliases.join(',') === 'legacy/day,legacy/night' &&
      row.compute.params.day_color.ct === 4200 &&
      row.compute.params.day_brightness === 0.65,
    'Create preserves every alias, Kelvin and brightness',
  );
  input(document.querySelector('[data-field=name]'), 'Draft source name');
  await pause();
  [...document.querySelectorAll('a[href="/config/sources"]')]
    .find((el) => el.offsetParent !== null)
    .click();
  await until(
    () => location.pathname === '/config/sources',
    'Source list opened',
  );
  const retained = () =>
    [...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(
      (el) => el.href.endsWith('/' + id),
    );
  await until(retained, 'Draft link shown');
  retained().click();
  await until(
    () => document.querySelector('[data-field=name]'),
    'Source draft returned',
  );
  assert(
    document.querySelector('[data-field=name]').value === 'Draft source name',
    'Navigation retains the source draft',
  );
  await fetch(`${root}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...row,
      refresh_interval_ms: 120000,
      expected: row,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Source conflict detected');
  button('Review changes').click();
  await until(() => button('Use reviewed choices'), 'Review ready');
  button('Use reviewed choices').click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Source reviewed save done');
  row = await saved();
  assert(
    row.name === 'Draft source name' &&
      row.refresh_interval_ms === 120000 &&
      row.revision === 3,
    'Conflict review keeps remote timing and the server revision',
  );
  assert(
    ![...document.querySelectorAll('main input, main select')].some(
      (el) => el.getBoundingClientRect().right > innerWidth + 1,
    ),
    'Source controls fit the viewport',
  );
  return { passed: true, checks };
})();

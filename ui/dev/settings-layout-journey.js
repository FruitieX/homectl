(async () => {
  const endpoint = '/api/v1/config/dashboard/layouts';
  const marker = await fetch(endpoint);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use isolated fixture.');
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
      ),
    field = () => document.querySelector('[data-field="name"]');
  const input = (value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () =>
    (await (await fetch(endpoint)).json()).data.find((row) => row.id === 1);
  await until(field, 'Layout loaded');
  input('Home display');
  await pause();
  document.querySelector('a[href="/config/dashboard/1/widgets/new"]').click();
  await until(
    () => document.querySelector('[aria-label="Widget type"]'),
    'New widget opened',
  );
  history.back();
  await until(field, 'Layout returned');
  assert(
    field().value === 'Home display' && (await saved()).name === 'Home',
    'Layout rename is retained across widget navigation without saving',
  );
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Layout saved');
  assert(
    (await saved()).name === 'Home display',
    'Explicit Save persists the layout name',
  );
  input('Local layout name');
  await pause();
  const row = await saved();
  await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...row,
      name: 'Remote layout name',
      expected: row.revision_token,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Layout conflict');
  assert(
    field().value === 'Local layout name',
    'A stale layout save retains the draft',
  );
  button('Discard').click();
  await pause();
  assert(
    field().value === 'Remote layout name',
    'Discard uses the latest saved layout',
  );
  input('');
  await pause();
  button('Save changes').click();
  await until(
    () => field().getAttribute('aria-invalid') === 'true',
    'Validation',
  );
  assert(
    document.activeElement === field(),
    'An empty layout name receives validation focus',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Layout controls fit the viewport',
  );
  return { passed: true, checks };
})();

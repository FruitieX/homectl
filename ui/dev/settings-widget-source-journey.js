(async () => {
  const endpoint = '/api/v1/config/widget-sources';
  const marker = await fetch(endpoint);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (fn, message) => {
    for (let i = 0; i < 80; i++) {
      if (fn()) return;
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
  const field = (name) => document.querySelector(`[data-field="${name}"]`);
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () =>
    (await (await fetch(endpoint)).json()).data.find(
      (row) => row.key === 'influxdb',
    );
  const save = async () => {
    button('Save changes').click();
    await until(() => !button('Save changes'), 'Saved');
  };
  await until(() => field('token'), 'Source loaded');
  assert(
    field('token').value === '' && (await saved()).credentials.token,
    'Saved source credentials are represented by presence only',
  );
  input(field('url'), 'http://new-influx.example');
  input(field('token'), 'pending-fixture-token');
  await pause();
  document.querySelector('a[href="/config/sensors"]').click();
  await until(
    () => document.querySelector('h1')?.textContent === 'Sensor names',
    'Related catalog opened',
  );
  history.back();
  await until(() => field('token'), 'Source returned');
  assert(
    field('token').value === 'pending-fixture-token' &&
      field('url').value === 'http://new-influx.example',
    'Related sensor navigation retains source edits and credentials in memory',
  );
  assert(
    (await saved()).config.url === 'http://influx.example',
    'Related navigation does not save the source',
  );
  await save();
  assert(
    field('token').value === '' &&
      (await saved()).config.url === 'http://new-influx.example',
    'Explicit Save applies source fields and clears the browser credential input',
  );
  input(field('url'), 'http://reviewed-influx.example');
  await pause();
  const previous = await saved();
  await fetch(endpoint + '/influxdb', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: { token: 'remote-fixture-token' },
      expected: previous.revisionToken,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict shown');
  button('Review changes').click();
  await pause();
  assert(
    !document.body.innerText.includes('remote-fixture-token') &&
      field('url').value === 'http://reviewed-influx.example',
    'Secret-only remote changes reject stale saves without revealing secrets or losing edits',
  );
  button('Use reviewed choices').click();
  await pause();
  await save();
  assert(
    (await saved()).config.url === 'http://reviewed-influx.example' &&
      (await saved()).credentials.token,
    'Reviewed save preserves the remotely replaced token',
  );
  const clear = () =>
    [...document.querySelectorAll('label')]
      .find((el) => el.textContent.trim() === 'Remove on Save')
      .querySelector('input');
  clear().click();
  await pause();
  assert(
    (await saved()).credentials.token,
    'Credential removal waits for Save',
  );
  button('Discard').click();
  await pause();
  assert(!clear().checked, 'Discard cancels credential removal');
  clear().click();
  await pause();
  await save();
  assert(
    !(await saved()).credentials.token,
    'Explicit Save removes the credential',
  );
  input(field('url'), 'file:///invalid');
  await pause();
  button('Save changes').click();
  await until(
    () => field('url').getAttribute('aria-invalid') === 'true',
    'URL validation',
  );
  assert(
    document.activeElement === field('url') &&
      (await saved()).config.url === 'http://reviewed-influx.example',
    'Invalid source URL receives focus without submitting',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Widget source fields fit the viewport',
  );
  return { passed: true, checks };
})();

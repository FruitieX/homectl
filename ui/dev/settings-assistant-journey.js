(async () => {
  const endpoint = '/api/v1/config/assistant/settings',
    marker = await fetch(endpoint);
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
  const field = (name) => document.querySelector(`[data-field="${name}"]`);
  const input = (el, value) => {
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
  const tab = (name) =>
    button(name).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 }),
    );
  await until(() => field('apiKey'), 'Provider form loaded');
  assert(
    field('apiKey').value === '' && (await saved()).apiKeySet,
    'Stored credentials are represented by presence, never returned in the input',
  );
  input(field('apiKey'), 'fixture-replacement-draft');
  input(field('contextWindow'), '64000');
  await pause();
  tab('Behavior');
  await until(() => field('warmup_time_seconds'), 'Behavior opened');
  tab('Assistant');
  await until(() => field('apiKey'), 'Assistant returned');
  assert(
    field('apiKey').value === 'fixture-replacement-draft' &&
      field('contextWindow').value === '64000',
    'Provider draft and pending credential survive tab navigation',
  );
  assert(
    (await saved()).contextWindow === 128000,
    'Navigation does not save provider options',
  );
  await save();
  assert(
    field('apiKey').value === '' && (await saved()).contextWindow === 64000,
    'Saving clears the entered credential from the browser draft and stores context size',
  );
  let row = await saved();
  input(field('model'), 'reviewed-model');
  await pause();
  await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: 'fixture-remote-key',
      expected: { revisionToken: row.revisionToken },
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Secret-only conflict detected');
  button('Review changes').click();
  await until(() => button('Use reviewed choices'), 'Review opened');
  assert(
    !document
      .querySelector('[role=dialog]')
      .innerText.includes('fixture-remote-key') &&
      !document
        .querySelector('[role=dialog]')
        .innerText.includes('fixture-replacement-draft'),
    'Conflict review does not reveal stored credentials',
  );
  button('Use reviewed choices').click();
  await pause();
  await save();
  assert(
    (await saved()).model === 'reviewed-model' && (await saved()).apiKeySet,
    'Review keeps the model edit and preserves the remotely replaced key',
  );
  const clear = () =>
    document.querySelector('[aria-label="Remove stored API key on save"]');
  clear().click();
  await pause();
  assert(
    (await saved()).apiKeySet,
    'Selecting key removal does not write immediately',
  );
  button('Discard').click();
  await pause();
  assert(
    !clear().checked && (await saved()).apiKeySet,
    'Discard cancels pending key removal',
  );
  clear().click();
  await pause();
  await save();
  assert(
    !(await saved()).apiKeySet && !clear(),
    'Explicit Save removes the stored key',
  );
  input(field('contextWindow'), '999');
  await pause();
  button('Save changes').click();
  await pause();
  assert(
    document.activeElement === field('contextWindow') &&
      (await saved()).contextWindow === 64000,
    'Invalid context size is focused and not submitted',
  );
  button('Discard').click();
  await pause();
  assert(
    ![...document.querySelectorAll('main input, main select')].some(
      (el) => el.getBoundingClientRect().right > innerWidth + 1,
    ),
    'Provider controls fit the viewport',
  );
  return { passed: true, checks };
})();

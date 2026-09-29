(async () => {
  const endpoint = '/api/v1/config/core',
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
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const save = async () => {
    button('Save changes').click();
    await until(() => !button('Save changes'), 'Saved');
  };
  await until(() => field('warmup_time_seconds'), 'System settings loaded');
  input(field('warmup_time_seconds'), '5');
  input(
    document.querySelector('[aria-label="default_transition_ms mode"]'),
    'default',
  );
  await pause();
  input(
    document.querySelector('[aria-label="default_transition_ms mode"]'),
    'custom',
  );
  await pause();
  assert(
    field('default_transition_ms').value === '1200',
    'Transition mode switching retains the custom duration',
  );
  input(
    document.querySelector('[aria-label="default_transition_ms mode"]'),
    'default',
  );
  input(field('scene_transition_ms'), '0');
  await pause();
  button('Appearance').dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0 }),
  );
  await until(
    () => document.querySelector('#shared-preferences'),
    'Appearance opened',
  );
  button('Behavior').dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0 }),
  );
  await until(() => field('warmup_time_seconds'), 'Behavior returned');
  assert(
    field('warmup_time_seconds').value === '5' &&
      document.querySelector('[aria-label="default_transition_ms mode"]')
        .value === 'default',
    'Switching tabs retains the system draft',
  );
  assert(
    (await saved()).warmup_time_seconds === 1 &&
      (await saved()).default_transition_ms === 1200,
    'Tab navigation does not save pending changes',
  );
  await save();
  let row = await saved();
  assert(
    row.default_transition_ms === null &&
      row.scene_transition_ms === 0 &&
      row.warmup_time_seconds === 5,
    'Saving distinguishes default, zero duration and warmup',
  );
  input(field('warmup_time_seconds'), '6');
  await pause();
  await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene_transition_ms: 9000, expected: row }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict shown');
  button('Review changes').click();
  await until(() => button('Use reviewed choices'), 'Review opened');
  button('Use reviewed choices').click();
  await pause();
  await save();
  row = await saved();
  assert(
    row.warmup_time_seconds === 6 && row.scene_transition_ms === 9000,
    'Conflict review preserves a remotely changed sibling setting',
  );
  input(field('warmup_time_seconds'), '-1');
  button('Save changes').click();
  await pause();
  assert(
    document.activeElement === field('warmup_time_seconds') &&
      (await saved()).warmup_time_seconds === 6,
    'Invalid warmup is focused and never submitted',
  );
  button('Discard').click();
  await pause();
  assert(
    field('warmup_time_seconds').value === '6',
    'Discard restores the saved system settings',
  );
  assert(
    ![...document.querySelectorAll('main input, main select')].some(
      (el) => el.getBoundingClientRect().right > innerWidth + 1,
    ),
    'System controls fit the viewport',
  );
  return { passed: true, checks };
})();

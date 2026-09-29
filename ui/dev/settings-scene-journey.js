(async () => {
  const response = await fetch('/api/v1/config/scenes');
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated marked development fixture on port 3021.');
  const original = (await response.json()).data.find(
    (row) => row.id === 'normal',
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
  const field = (path) => document.querySelector(`[data-field="${path}"]`);
  const set = (el, value) => {
    if (!el) throw Error('Missing control');
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
    (await (await fetch('/api/v1/config/scenes')).json()).data.find(
      (row) => row.id === 'normal',
    );
  const power = () => document.getElementById('group_states/living_room/power');
  await until(() => power(), 'Scene loaded');
  power().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  await until(
    () => document.querySelector('[role=option]'),
    'Power choices opened',
  );
  [...document.querySelectorAll('[role=option]')]
    .find((el) => el.textContent.trim() === 'Off')
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  await pause();
  assert(
    field('group_states/living_room/brightness').value === '80',
    'Turning off preserves brightness',
  );
  field('group_states/living_room/color').click();
  await pause();
  set(document.querySelector('[aria-label="Hue"]'), '210');
  button('Cancel').click();
  await pause();
  field('group_states/living_room/color').click();
  await pause();
  assert(
    document.querySelector('[aria-label="Hue"]').value === '32',
    'Cancel color leaves the draft unchanged',
  );
  set(document.querySelector('[aria-label="Hue"]'), '120');
  button('Apply color').click();
  await pause();
  document.querySelector('a[href="/config/groups/living_room"]').click();
  await until(
    () => location.pathname === '/config/groups/living_room',
    'Related group opened',
  );
  await until(
    () => document.querySelector('[aria-label="Retained drafts"] a'),
    'Draft link available',
  );
  document.querySelector('[aria-label="Retained drafts"] a').click();
  await until(() => power(), 'Scene draft returned');
  assert(
    power().textContent.trim() === 'Off',
    'Target edits survive related-page navigation',
  );
  assert(
    (await saved()).group_states.living_room.power === true,
    'Opening a reference does not save or activate',
  );
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Save finished');
  const updated = await saved();
  assert(
    updated.group_states.living_room.power === false &&
      updated.group_states.living_room.brightness === 0.8 &&
      updated.group_states.living_room.color.h === 120,
    'Save keeps off-state brightness and edited color',
  );
  assert(
    JSON.stringify(updated.device_states) ===
      JSON.stringify(original.device_states),
    'Untouched explicit, device-link, scene-link and missing targets survive the round trip',
  );
  document
    .querySelector('[aria-label="Actions for Living room"]')
    .dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerType: 'mouse',
      }),
    );
  await pause();
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.textContent.includes('Move later'))
    .click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Order save finished');
  assert(
    (await saved()).group_state_order.indexOf('living_room') >
      (await saved()).group_state_order.indexOf('kitchen'),
    'Group precedence is editable and persisted',
  );
  button('Preview draft').click();
  await until(
    () => document.querySelector('#preview')?.textContent.includes('Evaluated'),
    'Native preview returned',
  );
  assert(
    document.querySelectorAll('#preview [role="img"]').length > 0,
    'Server preview displays resolved states with rings',
  );
  button('Add devices').click();
  await pause();
  const selected = [
    ...document.querySelectorAll('[role="dialog"] input[type="checkbox"]'),
  ].filter((el) => !el.checked && !el.disabled);
  selected[0].click();
  selected[1].click();
  button('Done').click();
  await pause();
  assert(
    Boolean(button('Save changes')),
    'Multiple targets can be added to one draft',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'No horizontal overflow',
  );
  await fetch('/api/v1/config/scenes/normal', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(original),
  });
  document
    .querySelector('[data-target-key="living_room"]')
    .scrollIntoView({ block: 'start' });
  return { passed: true, checks };
})().catch((error) => ({
  passed: false,
  error: error.message,
  stack: error.stack,
}));

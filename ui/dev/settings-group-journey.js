(async () => {
  // This journey mutates only the isolated development fixture server.
  const fixtureResponse = await fetch('/api/v1/config/groups');
  if (fixtureResponse.headers.get('x-homectl-fixture') !== 'true')
    throw new Error(
      'Refusing to mutate an API without the development fixture marker.',
    );
  const fixture = await fixtureResponse.json();
  if (location.hostname !== '127.0.0.1' || location.port !== '3021')
    throw new Error(
      'Use the isolated settings fixture server on 127.0.0.1:3021.',
    );
  if (!fixture.data?.some((row) => row.id === 'living_room'))
    throw new Error('Expected the normal development fixture');
  const results = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
  const until = async (predicate, message) => {
    for (let i = 0; i < 60; i++) {
      if (predicate()) return;
      await pause();
    }
    throw new Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  const input = (selector, value) => {
    const field = document.querySelector(selector);
    if (!field) throw new Error('Missing input: ' + selector);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === text,
    );
  const group = async () =>
    (await (await fetch('/api/v1/config/groups')).json()).data.find(
      (row) => row.id === 'living_room',
    );
  await until(
    () => document.querySelector('[data-field="name"]'),
    'Group editor loaded',
  );
  const original = await group();
  input('[data-field="name"]', 'Living room draft check');
  await until(() => button('Save changes'), 'Save bar appeared');
  document.querySelector('a[href="/config/scenes/normal"]').click();
  await until(
    () => location.pathname === '/config/scenes/normal',
    'Related scene opened',
  );
  await until(
    () => document.querySelector('[aria-label="Retained drafts"] a'),
    'Retained draft rendered',
  );
  const retained = document.querySelector('[aria-label="Retained drafts"] a');
  assert(Boolean(retained), 'Draft return link appears on a related page');
  retained.click();
  await until(
    () => document.querySelector('[data-field="name"]'),
    'Returned to group',
  );
  assert(
    document.querySelector('[data-field="name"]').value ===
      'Living room draft check',
    'Draft survives related-page navigation',
  );
  assert(
    (await group()).name === original.name,
    'Navigation did not save the draft',
  );
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Save finished');
  assert(
    (await group()).name === 'Living room draft check',
    'Explicit Save persists the full entity',
  );
  input('[data-field="name"]', 'Unsaved replacement');
  await pause();
  button('Discard').click();
  await pause();
  assert(
    document.querySelector('[data-field="name"]').value ===
      'Living room draft check',
    'Discard restores the saved entity',
  );
  input('[data-field="name"]', 'My conflicting name');
  await pause();
  const current = await group();
  await fetch('/api/v1/config/groups/living_room', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...current,
      name: 'Changed elsewhere',
      hidden: true,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict review offered');
  assert(
    document.querySelector('[data-field="name"]').value ===
      'My conflicting name',
    'Concurrent write leaves my draft intact',
  );
  button('Review changes').click();
  await pause();
  assert(
    document.body.innerText.includes('Changed elsewhere'),
    'Conflict review exposes the competing saved value',
  );
  button('Use reviewed choices').click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Reviewed save finished');
  const merged = await group();
  assert(
    merged.name === 'My conflicting name' && merged.hidden === true,
    'Reviewed save preserves unrelated remote changes',
  );
  button('Add devices').click();
  await pause();
  const checkboxes = [
    ...document.querySelectorAll('[role="dialog"] input[type="checkbox"]'),
  ];
  const unchecked = checkboxes.filter(
    (field) => !field.checked && !field.disabled,
  );
  unchecked[0].click();
  unchecked[1].click();
  button('Done').click();
  await pause();
  assert(
    button('Save changes'),
    'Multiple device selections update one entity draft',
  );
  button('Discard').click();
  await pause();
  input('[data-field="name"]', '');
  await pause();
  button('Save changes').click();
  await pause();
  assert(
    document.activeElement.dataset.field === 'name',
    'Validation focuses the invalid field',
  );
  assert(
    document.body.innerText.includes('Give this room or group a name.'),
    'Validation explains how to repair the value',
  );
  button('Discard').click();
  await fetch('/api/v1/config/groups/living_room', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(original),
  });
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'No horizontal overflow',
  );
  return { passed: true, checks: results };
})().catch((error) => ({
  passed: false,
  error: error.message,
  stack: error.stack,
}));

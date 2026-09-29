(async () => {
  const base = '/api/v1/config/dashboard',
    endpoint = base + '/layouts/1/arrangement';
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
    for (let i = 0; i < 100; i++) {
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
    named = (name) => document.querySelector(`[aria-label="${name}"]`);
  const key = (el, key, alt = false) => {
    el.focus();
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, altKey: alt, bubbles: true }),
    );
  };
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const save = async () => {
    (button('Save changes') ?? button('Retry save')).click();
    await until(
      () => !button('Save changes') && !button('Retry save'),
      'Arrangement saved',
    );
  };
  await until(() => named('Resize Indoor readings'), 'Editor loaded');
  await fetch(base + '/widgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 0,
      layout_id: 1,
      widget_type: 'text',
      config: { title: 'Second card', options: { body: 'Fixture note' } },
      grid_x: 0,
      grid_y: 0,
      grid_w: 2,
      grid_h: 2,
      sort_order: 1,
    }),
  });
  named('Edit Indoor readings').click();
  await until(
    () => document.querySelector('[data-field="title"]'),
    'Widget opened',
  );
  history.back();
  await until(() => named('Resize Second card'), 'Editor refreshed');
  const original = await saved();
  key(named('Resize Indoor readings'), 'ArrowRight');
  await until(() => button('Save changes'), 'Resize staged');
  key(named('Second card arrangement'), 'ArrowUp', true);
  await pause();
  assert(
    JSON.stringify(await saved()) === JSON.stringify(original),
    'Keyboard resizing and reordering do not write before Save',
  );
  named('Edit Indoor readings').click();
  await until(
    () => document.querySelector('[data-field="title"]'),
    'Related widget opened',
  );
  assert(
    Boolean(
      document.querySelector(
        '[aria-label="Retained drafts"] a[href="/?edit=1&layout=1"]',
      ),
    ),
    'Pending arrangement has a discoverable return link',
  );
  history.back();
  await until(() => named('Resize Second card'), 'Editor returned');
  assert(
    Boolean(button('Save changes')),
    'Arrangement draft survives editing a related widget',
  );
  await save();
  let current = await saved();
  assert(
    current.placements['1'].grid_w === original.placements['1'].grid_w + 0.25 &&
      current.placements['2'].sort_order === 0,
    'One save applies both size and order',
  );
  named('Remove Second card').click();
  await until(() => button('Stage removal'), 'Removal confirmation');
  button('Stage removal').click();
  await until(() => !named('Resize Second card'), 'Removal staged');
  assert(
    Boolean((await saved()).placements['2']),
    'Removal is staged with the arrangement',
  );
  button('Discard').click();
  await until(() => named('Resize Second card'), 'Removal discarded');
  assert(
    Boolean(named('Resize Second card')),
    'Discard restores a staged removal',
  );
  key(named('Resize Indoor readings'), 'ArrowDown');
  await pause();
  await fetch('/api/__fixture/arrangement-failure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fail: true }),
  });
  button('Save changes').click();
  await until(() => button('Retry save'), 'Failure shown');
  assert(
    JSON.stringify(await saved()) === JSON.stringify(current),
    'A rejected batch leaves all saved placements unchanged',
  );
  assert(
    Boolean(button('Discard')),
    'A failed save keeps the arrangement draft',
  );
  await fetch('/api/__fixture/arrangement-failure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fail: false }),
  });
  await save();
  current = await saved();
  key(named('Resize Indoor readings'), 'ArrowRight');
  await pause();
  const rows = (await (await fetch(base + '/layouts/1/widgets')).json()).data,
    row = rows.find((row) => row.id === 1);
  await fetch(base + '/widgets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...row,
      config: { ...row.config, title: 'Remotely renamed' },
      expected: row.revision_token,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict shown');
  button('Review changes').click();
  await pause();
  button('Use reviewed choices').click();
  await pause();
  await save();
  assert(
    (await (await fetch(base + '/layouts/1/widgets')).json()).data.find(
      (row) => row.id === 1,
    ).config.title === 'Remotely renamed',
    'Arrangement conflict review preserves remotely changed widget content',
  );
  named('Remove Second card').click();
  await until(() => button('Stage removal'), 'Removal confirmation again');
  button('Stage removal').click();
  await until(() => !named('Resize Second card'), 'Removal staged again');
  await save();
  assert(
    !(await saved()).placements['2'],
    'Saving applies the explicit removal',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Arrangement editor and save controls fit the viewport',
  );
  return { passed: true, checks };
})();

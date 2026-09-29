(async () => {
  const endpoint = '/api/v1/config/floorplans/ground_floor/editor';
  const marker = await fetch(endpoint);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.origin !== 'http://127.0.0.1:3021'
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
  const assert = (value, msg) => {
    if (!value) throw Error(msg);
    checks.push(msg);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const name = () => document.querySelector('[data-field="name"]');
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const upload = async (el, text, type, filename) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], filename, { type }));
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  await until(
    () => name() && document.querySelector('canvas'),
    'Floorplan loaded',
  );
  const original = await saved();
  const width = document.querySelector(
    '[aria-label="Floorplan width in tiles"]',
  );
  width.focus();
  input(width, '');
  await pause();
  assert(
    !button('Save changes') &&
      JSON.parse((await saved()).grid_data).width === 12,
    'Clearing a dimension while typing does not resize or save the canvas',
  );
  input(width, '14');
  width.blur();
  await pause();
  input(name(), 'Downstairs');
  await pause();
  const canvas = document.querySelector('canvas');
  canvas.focus();
  canvas.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  await pause();
  canvas.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  );
  await pause();
  canvas.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
  );
  await pause();
  await upload(
    document.querySelector('input[type="file"][accept^="image/"]'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16"><rect width="24" height="16" fill="orange"/></svg>',
    'image/svg+xml',
    'new-background.svg',
  );
  await until(
    () =>
      document
        .querySelector('img[alt="Floorplan background preview"]')
        ?.src.startsWith('data:'),
    'Image staged',
  );
  assert(
    (await saved()).revision_token === original.revision_token,
    'Name, keyboard painting, dimensions and image replacement stay unsaved',
  );
  const related = document.querySelector('a[href^="/config/devices/detail/"]');
  related.click();
  await until(
    () => location.pathname.startsWith('/config/devices/detail/') && document.querySelector('[aria-label="Retained drafts"]'),
    'Related device',
  );
  assert(
    document
      .querySelector('[aria-label="Retained drafts"]')
      .textContent.includes('Ground floor'),
    'Related navigation retains a discoverable floorplan draft',
  );
  history.back();
  await until(() => name()?.value === 'Downstairs', 'Draft restored');
  assert(
    document.querySelector('[aria-label="Floorplan width in tiles"]').value ===
      '14' &&
      document
        .querySelector('img[alt="Floorplan background preview"]')
        .src.startsWith('data:'),
    'Pending layout and image survive related navigation',
  );
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Floorplan saved');
  const updated = await saved(),
    grid = JSON.parse(updated.grid_data);
  assert(
    updated.name === 'Downstairs' &&
      grid.width === 14 &&
      grid.tiles[1][1] === 'wall' &&
      updated.image.revision !== original.image.revision,
    'One Save applies the complete floorplan draft',
  );
  assert(
    grid.labelMode === 'all' &&
      JSON.stringify(grid.future) === JSON.stringify({ keep: [2, 1] }),
    'Drawing and resizing preserve labels and extension fields',
  );
  button('Remove image').click();
  await pause();
  assert(
    !document.querySelector('img[alt="Floorplan background preview"]') &&
      (await saved()).image.kind === 'stored',
    'Image removal is staged',
  );
  button('Discard').click();
  await pause();
  assert(
    !!document.querySelector('img[alt="Floorplan background preview"]'),
    'Discard restores the saved background',
  );
  input(name(), 'Local floor name');
  await pause();
  const remote = await saved();
  await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...remote,
      expected: remote.revision_token,
      grid_data: JSON.stringify({
        ...JSON.parse(remote.grid_data),
        deviceScale: 1.6,
      }),
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict review');
  assert(
    name().value === 'Local floor name',
    'Conflicts keep the pending floorplan name',
  );
  button('Review changes').click();
  await until(
    () => document.querySelector('[role="dialog"]'),
    'Conflict dialog',
  );
  const useReviewed = [
    ...document.querySelectorAll('[role="dialog"] button'),
  ].find((el) => el.textContent.includes('Use reviewed'));
  if (!useReviewed) throw Error('Missing reviewed draft action');
  useReviewed.click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Reviewed floorplan saved');
  assert(
    (await saved()).name === 'Local floor name' &&
      JSON.parse((await saved()).grid_data).deviceScale === 1.6,
    'Conflict review keeps unrelated remote layout changes',
  );
  document.querySelector('a[href="/config/floorplan?new=1"]').click();
  await until(() => button('Create floorplan'), 'New floorplan editor');
  input(name(), 'Upstairs');
  await pause();
  button('Create floorplan').click();
  await until(
    () =>
      location.search.includes('id=upstairs') && !button('Create floorplan'),
    'Floorplan created',
  );
  assert(
    (await (await fetch('/api/v1/config/floorplans/upstairs/editor')).json())
      .data.name === 'Upstairs',
    'Create uses the same explicit-save editor',
  );
  button('Delete floorplan').click();
  await until(
    () => document.querySelector('[role="alertdialog"]'),
    'Delete confirmation',
  );
  button('Cancel').click();
  await pause();
  assert(
    (await fetch('/api/v1/config/floorplans/upstairs/editor')).ok,
    'Canceling deletion keeps the floorplan',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Floorplan controls fit the viewport',
  );
  return { passed: true, checks };
})();

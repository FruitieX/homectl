(async () => {
  const endpoint = '/api/v1/config/floorplans/ground_floor/editor',
    marker = await fetch(endpoint);
  if (
    location.origin !== 'http://127.0.0.1:3021' ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Use the isolated fixture.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 150)),
    assert = (value, name) => {
      if (!value) throw Error(name);
      checks.push(name);
    };
  const until = async (fn, name) => {
    for (let n = 0; n < 80; n++) {
      if (fn()) return;
      await pause();
    }
    throw Error(
      name +
        ' @ ' +
        location.href +
        ' ' +
        document.querySelector('.floorplan-page')?.textContent.slice(0, 450),
    );
  };
  const click = async (label) => {
    document.querySelector(`[aria-label="${label}"]`).click();
    await pause();
  };
  const button = async (text) => {
    [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === text)
      .click();
    await pause();
  };
  const menu = async (text) => {
    const trigger = document.querySelector('[aria-label="Document menu"]');
    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await until(
      () => document.querySelector('[role="menu"]'),
      'Document menu opened',
    );
    const el = [...document.querySelectorAll('[role="menuitem"]')].find(
      (e) => e.textContent.trim() === text,
    );
    if (!el) throw Error('Menu item ' + text);
    el.click();
    await pause();
  };
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const upload = async (selector, text, type, filename) => {
    const el = document.querySelector(selector),
      files = new DataTransfer();
    files.items.add(new File([text], filename, { type }));
    el.files = files.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const original = await saved(),
    originalFetch = window.fetch,
    writes = [];
  window.fetch = (url, options) => {
    if (String(url).endsWith(endpoint) && options?.method === 'PUT')
      writes.push(JSON.parse(options.body));
    return originalFetch(url, options);
  };
  try {
    await click('Layout tool');
    input(document.querySelector('#floorplan-name'), 'Downstairs');
    await pause();
    const grid = {
      ...JSON.parse(original.grid_data),
      labelMode: 'all',
      deviceScale: 1.2,
      future: { keep: [2, 1], imported: true },
    };
    await upload(
      '[aria-label="Import floorplan layout"]',
      JSON.stringify(grid),
      'application/json',
      'layout.json',
    );
    await click('Layout tool');
    await upload(
      '[aria-label="Choose floorplan background image"]',
      '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="540"><rect width="720" height="540" fill="#f5f3ea"/></svg>',
      'image/svg+xml',
      'floor.svg',
    );
    await until(
      () =>
        document
          .querySelector('img[alt="Floorplan background preview"]')
          ?.src.startsWith('data:'),
      'Background staged',
    );
    assert(
      (await saved()).revision_token === original.revision_token &&
        writes.length === 0,
      'Name, imported layout and uploaded image stay unsaved',
    );
    await click('Devices tool');
    const row = [...document.querySelectorAll('.fp-entity')].find((b) =>
      b.querySelector('small')?.textContent.includes('placed'),
    );
    row.click();
    await pause();
    document.querySelector('a[href^="/config/devices/detail/"]').click();
    await until(
      () =>
        location.pathname.startsWith('/config/devices/detail/') &&
        document.querySelector('[aria-label="Retained drafts"]'),
      'Related navigation',
    );
    assert(
      document
        .querySelector('[aria-label="Retained drafts"]')
        .textContent.includes(original.name),
      'Related navigation retains the floorplan draft',
    );
    history.back();
    await until(() => document.querySelector('canvas'), 'Returned editor');
    await click('Layout tool');
    assert(
      document.querySelector('#floorplan-name').value === 'Downstairs' &&
        document
          .querySelector('img[alt="Floorplan background preview"]')
          .src.startsWith('data:'),
      'Imported layout, name and image survive navigation',
    );
    await button('Save');
    await until(
      () =>
        document.querySelector('.settings-savebar')?.dataset.dirty === 'false',
      'Saved',
    );
    const updated = await saved();
    assert(
      writes.length === 1 &&
        updated.name === 'Downstairs' &&
        updated.image.kind === 'stored' &&
        JSON.parse(updated.grid_data).future.imported,
      'One atomic Save persists name, image and complete imported layout',
    );
    await click('Layout tool');
    await button('Remove');
    assert(
      (await saved()).image.kind === 'stored' &&
        !document.querySelector('img[alt="Floorplan background preview"]'),
      'Removing a background is staged',
    );
    if (innerWidth < 900) await menu('Discard unsaved changes');
    else await button('Discard');
    await click('Layout tool');
    assert(
      !!document.querySelector('img[alt="Floorplan background preview"]'),
      'Discard restores the saved background',
    );
    await upload(
      '[aria-label="Import floorplan layout"]',
      '{"width":2}',
      'application/json',
      'bad.json',
    );
    assert(
      document
        .querySelector('.fp-banner')
        ?.textContent.includes('Canvas dimensions') &&
        document.querySelector('canvas'),
      'Invalid import reports an error and retains the canvas',
    );
    const unsupported = JSON.stringify({
      ...JSON.parse(updated.grid_data),
      labelMode: 'future-mode',
      future: { keep: 'raw' },
    });
    await originalFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...updated,
        grid_data: unsupported,
        expected: updated.revision_token,
      }),
    });
    // An unsupported external layout is displayed after explicitly leaving and returning.
    document.querySelector('a[href="/config"]').click();
    await until(
      () =>
        location.pathname === '/config' &&
        !document.querySelector('.floorplan-page'),
      'Leave editor',
    );
    history.back();
    await until(
      () => document.querySelector('.fp-unavailable'),
      'Unsupported layout retained',
    );
    await click('Layout tool');
    input(document.querySelector('#floorplan-name'), 'Preserved future floor');
    await pause();
    await button('Save');
    await until(
      () =>
        document.querySelector('.settings-savebar')?.dataset.dirty === 'false',
      'Metadata saved',
    );
    assert(
      (await saved()).grid_data === unsupported,
      'Metadata save preserves unsupported layout byte for byte',
    );
    await menu('Reset layout…');
    await until(
      () => document.querySelector('[role="alertdialog"]'),
      'Reset confirmation',
    );
    await button('Cancel');
    assert(
      (await saved()).grid_data === unsupported,
      'Canceling reset preserves unsupported data',
    );
    await menu('New floorplan');
    await until(
      () => document.querySelector('#floorplan-name'),
      'New floorplan',
    );
    input(document.querySelector('#floorplan-name'), 'Study upstairs');
    await pause();
    await button('Create');
    await until(() => location.search.includes('id=study-upstairs'), 'Created');
    assert(
      (
        await (
          await fetch('/api/v1/config/floorplans/study-upstairs/editor')
        ).json()
      ).data.name === 'Study upstairs',
      'New documents use explicit atomic creation',
    );
    await menu('Delete floorplan…');
    await until(
      () => document.querySelector('[role="alertdialog"]'),
      'Delete confirmation',
    );
    await button('Cancel');
    assert(
      (await fetch('/api/v1/config/floorplans/study-upstairs/editor')).ok,
      'Canceling deletion keeps the floorplan',
    );
    await menu('Delete floorplan…');
    await until(
      () => document.querySelector('[role="alertdialog"]'),
      'Delete confirmation',
    );
    await button('Delete');
    await until(() => !location.search.includes('study-upstairs'), 'Deleted');
    assert(
      !(await fetch('/api/v1/config/floorplans/study-upstairs/editor')).ok,
      'Confirmed deletion removes only its document',
    );
    assert(
      document.body.scrollHeight === innerHeight &&
        document.body.scrollWidth === innerWidth,
      'Document controls fit the fixed viewport',
    );
    return { passed: true, checks };
  } finally {
    window.fetch = originalFetch;
  }
})();

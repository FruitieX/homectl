(async () => {
  const initial = await fetch('/api/v1/config/groups');
  if (
    initial.headers.get('x-homectl-fixture') !== 'true' ||
    location.origin !== 'http://127.0.0.1:3021'
  )
    throw Error('Use the marked isolated fixture.');
  const original = (await initial.json()).data;
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const until = async (fn, label) => {
    for (let i = 0; i < 140; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(label);
  };
  const assert = (ok, label) => {
    if (!ok) throw Error(label);
    checks.push(label);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const check = (label) =>
    [...document.querySelectorAll('label')]
      .find((el) => el.textContent.trim().startsWith(label))
      ?.querySelector('input[type=checkbox]');
  const groupRows = async () =>
    (await (await fetch('/api/v1/config/groups')).json()).data;
  const upload = async (text, name = 'legacy.toml') => {
    const data = new DataTransfer();
    data.items.add(new File([text], name, { type: 'text/plain' }));
    const input = document.querySelector('input[type=file]');
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  const go = async (href) => {
    const link = [...document.querySelectorAll('a')].find(
      (el) => el.getAttribute('href') === href && el.offsetParent !== null,
    );
    if (!link) throw Error('Missing link ' + href);
    link.click();
    await until(() => location.pathname === href, 'Navigation');
    await pause();
  };
  const control = (body) =>
    fetch('/api/__fixture/migration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  await until(() => check('Connections'), 'Sections available');
  check('Connections').click();
  check('Rooms & groups').click();
  await pause();
  const file =
    "[groups.living_room]\nname='Imported living room'\n[groups.new_room]\nname='New imported room'\n[routines.legacy_motion]\nname='Legacy motion'\nrules=[{integration_id='missing', name='missing sensor',state={value=true}}]\nactions=[]\n";
  await upload(file);
  await until(
    () => document.querySelector('#migration-review'),
    'Review ready',
  );
  assert(
    document
      .querySelector('[aria-label="Import summary"]')
      .textContent.includes('1 to add') &&
      document
        .querySelector('[aria-label="Import summary"]')
        .textContent.includes('1 to replace'),
    'Review separates additions from replacements',
  );
  assert(
    (await groupRows()).find((g) => g.id === 'living_room').name ===
      original.find((g) => g.id === 'living_room').name,
    'Review does not import configuration',
  );
  await go('/config/groups/living_room');
  await until(
    () =>
      document.querySelector(
        '[aria-label="Retained drafts"] a[href="/config/migration"]',
      ),
    'Import draft discoverable',
  );
  await go('/config/migration');
  await until(
    () => document.querySelector('#migration-review'),
    'Review restored',
  );
  assert(
    document.body.textContent.includes('legacy.toml') &&
      !!document.querySelector('#migration-review'),
    'Related navigation retains file, scope and review',
  );
  check('Legacy routines').click();
  await pause();
  assert(
    document.body.textContent.includes('legacy.toml') &&
      !document.querySelector('#migration-review'),
    'Changing scope retains the file and invalidates its old review',
  );
  button('Review selected entries').click();
  await until(
    () => document.querySelector('[data-field=skipped]'),
    'Skipped reference review',
  );
  assert(
    button('Import selected entries').disabled,
    'Skipped references require explicit acknowledgment',
  );
  document.querySelector('[data-field=skipped]').click();
  await pause();
  button('Import selected entries').click();
  await until(() => button('Confirm import'), 'Confirmation opened');
  button('Cancel').click();
  await pause();
  assert(
    (await groupRows()).length === original.length,
    'Canceling import confirmation makes no changes',
  );
  await control({ fail: true });
  button('Import selected entries').click();
  await until(() => button('Confirm import'), 'Failure confirmation');
  button('Confirm import').click();
  await until(
    () => document.body.textContent.includes('Fixture import failed'),
    'Failure shown',
  );
  assert(
    document.body.textContent.includes('legacy.toml') &&
      !document.querySelector('#migration-review'),
    'Failed import keeps the file and requires review before retry',
  );
  await control({});
  button('Review selected entries').click();
  await until(
    () => document.querySelector('[data-field=skipped]'),
    'Retry review',
  );
  document.querySelector('[data-field=skipped]').click();
  await pause();
  const current = (await groupRows()).find((g) => g.id === 'bedroom');
  await fetch('/api/v1/config/groups/bedroom', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...current, name: 'Changed after review' }),
  });
  button('Import selected entries').click();
  await until(() => button('Confirm import'), 'Stale confirmation');
  button('Confirm import').click();
  await until(
    () => document.body.textContent.includes('saved setup changed'),
    'Stale review rejected',
  );
  assert(
    (await groupRows()).find((g) => g.id === 'living_room').name ===
      original.find((g) => g.id === 'living_room').name,
    'Stale review cannot replace entries',
  );
  button('Review selected entries').click();
  await until(
    () => document.querySelector('[data-field=skipped]'),
    'Fresh review',
  );
  document.querySelector('[data-field=skipped]').click();
  await pause();
  await control({ memoryOnly: true });
  button('Import selected entries').click();
  await until(() => button('Confirm import'), 'Final confirmation');
  button('Confirm import').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Selected entries applied, but not saved',
      ),
    'Persistence outcome',
  );
  const saved = await groupRows();
  assert(
    saved.find((g) => g.id === 'living_room').name === 'Imported living room' &&
      saved.find((g) => g.id === 'bedroom').name === 'Changed after review' &&
      saved.some((g) => g.id === 'new_room'),
    'Import merges selected entries and keeps unrelated changes',
  );
  const routines = (await (await fetch('/api/v1/config/routines')).json()).data;
  assert(
    routines.find((r) => r.id === 'legacy_motion').enabled === false,
    'A routine with skipped references remains disabled',
  );
  assert(
    document.body.textContent.includes('legacy.toml') && !button('Discard'),
    'Successful import retains the file for another pass without an unsaved draft',
  );
  await go('/config/integrations');
  history.back();
  await until(
    () => document.querySelector('h1')?.textContent === 'Import an older setup',
    'Return after completed import',
  );
  assert(
    document.body.textContent.includes('legacy.toml') && !button('Discard'),
    'The completed import file survives a device-discovery visit',
  );
  button('Review selected entries').click();
  await until(
    () => document.querySelector('#migration-review'),
    'Next pass review',
  );
  assert(
    document.body.textContent.includes('No selected entries would change') &&
      button('Import selected entries').disabled,
    'Unchanged repeated imports do not apply again',
  );
  button('Discard').click();
  await pause();
  assert(
    !document.body.textContent.includes('legacy.toml'),
    'Discard clears the uploaded file and review',
  );
  await upload('invalid TOML', 'broken.toml');
  await until(
    () => document.querySelector('[role=alert]'),
    'Invalid file feedback',
  );
  assert(
    !document.querySelector('#migration-review') &&
      document.body.textContent.includes('broken.toml'),
    'Invalid input stays available for correction and cannot be imported',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Migration controls fit the viewport',
  );
  return { passed: true, checks };
})();

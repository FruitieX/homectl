(async () => {
  const endpoint = '/api/v1/config',
    marker = await fetch(`${endpoint}/export`);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.origin !== 'http://127.0.0.1:3021'
  )
    throw Error('Use the isolated fixture.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (v, message) => {
    if (!v) throw Error(message);
    checks.push(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const saved = async () =>
    (await (await fetch(`${endpoint}/export`)).json()).data;
  const outcome = (body) =>
    fetch('/api/__fixture/restore-outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const upload = async (body, name = 'home-backup.json') => {
    const input = document.querySelector('input[type="file"]'),
      transfer = new DataTransfer();
    transfer.items.add(
      new File([typeof body === 'string' ? body : JSON.stringify(body)], name, {
        type: 'application/json',
      }),
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  await until(
    () => document.querySelector('input[type="file"]'),
    'Backup page loaded',
  );
  assert(
    !document.querySelector('input[type="checkbox"]').checked,
    'Downloads exclude credentials by default',
  );
  const original = await saved(),
    backup = structuredClone(original);
  const target = backup.groups[0];
  target.name = 'Restored kitchen';
  backup.groups.pop();
  await upload(backup);
  await until(() => button('Restore backup'), 'Backup reviewed');
  assert(
    document
      .querySelector('[aria-label="Affected entries"]')
      .textContent.includes('Restored kitchen') &&
      document
        .querySelector('[aria-label="Restore summary"]')
        .textContent.includes('1 to remove'),
    'Review lists replacements and removals',
  );
  assert(
    JSON.stringify(await saved()) === JSON.stringify(original),
    'Uploading and reviewing do not apply configuration',
  );
  document
    .querySelector(
      `[aria-label="Affected entries"] a[href="/config/groups/${target.id}"]`,
    )
    .click();
  await until(
    () => document.querySelector('[data-field="name"]'),
    'Related room opened',
  );
  assert(
    document
      .querySelector('[aria-label="Retained drafts"]')
      .textContent.includes('Backup restore'),
    'Related navigation keeps a discoverable restore draft',
  );
  history.back();
  await until(() => button('Restore backup'), 'Backup review retained');
  assert(
    document.body.textContent.includes('home-backup.json'),
    'Uploaded backup and review survive related navigation',
  );
  button('Restore backup').click();
  await until(() => button('Restore and replace'), 'Replacement confirmation');
  button('Cancel').click();
  await pause();
  assert(
    JSON.stringify(await saved()) === JSON.stringify(original),
    'Canceling replacement confirmation changes nothing',
  );
  await outcome({ fail: true });
  button('Restore backup').click();
  await until(() => button('Restore and replace'), 'Confirmation reopened');
  button('Restore and replace').click();
  await until(() => button('Review again'), 'Failed restore retained');
  assert(
    JSON.stringify(await saved()) === JSON.stringify(original) &&
      document.body.textContent.includes('home-backup.json'),
    'A failed restore keeps the file and leaves saved configuration unchanged',
  );
  await outcome({});
  button('Review again').click();
  await until(() => button('Restore backup'), 'Reviewed after failure');
  const remote = structuredClone(original.groups[0]);
  remote.name = 'Changed elsewhere';
  await fetch(`${endpoint}/groups/${remote.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(remote),
  });
  button('Restore backup').click();
  await until(() => button('Restore and replace'), 'Stale confirmation');
  button('Restore and replace').click();
  await until(() => button('Review again'), 'Stale review rejected');
  assert(
    (await saved()).groups[0].name === 'Changed elsewhere' &&
      document.body.textContent.includes('saved setup changed'),
    'Concurrent changes require a new review',
  );
  button('Review again').click();
  await until(() => button('Restore backup'), 'Fresh review');
  button('Restore backup').click();
  await until(() => button('Restore and replace'), 'Fresh confirmation');
  button('Restore and replace').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Backup restored and saved to the database.',
      ),
    'Restore success',
  );
  assert(
    (await saved()).groups[0].name === 'Restored kitchen' &&
      !button('Restore backup'),
    'Confirmed restore updates the setup and clears the pending operation',
  );
  const memory = await saved();
  memory.groups[0].name = 'Memory-only room';
  await outcome({ memoryOnly: true });
  await upload(memory, 'memory-only.json');
  await until(() => button('Restore backup'), 'Memory-only preview');
  button('Restore backup').click();
  await until(() => button('Restore and replace'), 'Memory-only confirmation');
  button('Restore and replace').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Backup applied, but not saved to the database.',
      ),
    'Memory-only warning',
  );
  assert(
    document.body.textContent.includes(
      'Fixture restore is applied in memory only.',
    ),
    'Memory-only application has a persistent warning',
  );
  await outcome({});
  await upload('{invalid-json', 'invalid.json');
  await until(
    () => document.body.textContent.includes('Could not read the backup'),
    'Invalid file error',
  );
  assert(!button('Restore backup'), 'An invalid upload cannot be restored');
  await upload(backup);
  await until(() => button('Restore backup'), 'Review to discard');
  button('Discard').click();
  await pause();
  assert(
    !document.querySelector('[aria-label="Affected entries"]') &&
      !document.querySelector('[aria-label="Restore backup"]'),
    'Discard removes the uploaded backup and review',
  );
  // Leave a reviewed, unapplied backup visible in the screenshot.
  await upload(backup);
  await until(() => button('Restore backup'), 'Final preview');
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Restore review fits the viewport',
  );
  return { passed: true, checks };
})();

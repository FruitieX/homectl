(async () => {
  const base = '/api/v1/config/calibration-editor',
    fixture = '/api/__fixture/calibration';
  const marker = await fetch(base);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use isolated fixture.');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 120));
  const until = async (fn, msg) => {
    for (let i = 0; i < 130; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(msg);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const btn = (t) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === t,
    );
  const get = async () => (await (await fetch(base)).json()).data;
  const evidence = async () => (await (await fetch(fixture)).json()).data;
  await fetch(fixture, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seed: true }),
  });
  let original = await get();
  const profile = {
    ...original.profiles[0],
    brightness_points: [
      { logical: 0.1, output: 0.2 },
      { logical: 1, output: 0.95 },
    ],
  };
  await fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expected: original.revision_token,
      profile,
      profile_id: profile.id,
      device_keys: ['zigbee2mqtt/living_room_lamp'],
    }),
  });
  original = await get();
  // Remount after seeding so every config hook reads the seeded catalog.
  history.pushState({}, '', '/groups');
  dispatchEvent(new PopStateEvent('popstate'));
  await pause();
  history.pushState(
    {},
    '',
    '/config/devices/detail/zigbee2mqtt/living_room_lamp?calibration=color',
  );
  dispatchEvent(new PopStateEvent('popstate'));
  await until(() => btn('Edit profile / add points'), 'Color editor seeded');
  btn('Edit profile / add points').click();
  await pause();
  const start = [...document.querySelectorAll('button')].find((b) =>
    b.textContent.startsWith('Start editing'),
  );
  start.click();
  await until(
    () =>
      btn('Looks matched · review') && !btn('Looks matched · review').disabled,
    'Live point ready',
  );
  assert(
    (await get()).revision_token === original.revision_token,
    'Matching edits do not write calibration',
  );
  const hue = document.querySelector('[aria-label="Lamp hue in degrees"]');
  const originalHue = hue.value;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
    hue,
    '',
  );
  hue.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
  assert(
    hue.value === '' && btn('Looks matched · review').disabled,
    'Incomplete hue stays visible and cannot be confirmed',
  );
  btn('Close calibration').click();
  await until(
    async () => Object.keys((await evidence()).sessions).length === 0,
    'Closing restores preview',
  );
  btn('Calibrate color').click();
  await until(
    () => btn('Resume live preview'),
    'Retained color draft reopened',
  );
  assert(
    Object.keys((await evidence()).sessions).length === 0,
    'Restored draft does not restart preview',
  );
  assert(
    document.querySelector('[aria-label="Lamp hue in degrees"]').value === '',
    'Incomplete numeric draft survives closing',
  );
  btn('Reset this point').click();
  await pause();
  assert(
    document.querySelector('[aria-label="Lamp hue in degrees"]').value !== '' &&
      !document
        .querySelector('[aria-label="Lamp hue in degrees"]')
        .hasAttribute('aria-invalid'),
    'Reset clears the unfinished numeric edit for this point',
  );
  const restoredHue = document.querySelector(
    '[aria-label="Lamp hue in degrees"]',
  );
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
    restoredHue,
    originalHue,
  );
  restoredHue.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
  btn('Resume live preview').click();
  await until(
    () =>
      btn('Looks matched · review') && !btn('Looks matched · review').disabled,
    'Preview resumed',
  );
  btn('Looks matched · review').click();
  await pause();
  assert(
    Boolean(btn('Save changes')),
    'Shared Save and Discard controls available',
  );
  btn('Save changes').click();
  await until(
    () => document.body.textContent.includes('The temporary preview has ended'),
    'Saved color result',
  );
  const saved = await get();
  assert(
    JSON.stringify(
      saved.profiles.find((p) => p.id === profile.id).brightness_points,
    ) === JSON.stringify(profile.brightness_points),
    'Saving color preserves existing brightness channel',
  );
  assert(
    Object.keys((await evidence()).sessions).length === 0,
    'Save stops preview before the atomic write',
  );
  assert(
    saved.assignments.some(
      (a) =>
        a.device_key === 'zigbee2mqtt/living_room_floor_lamp' &&
        a.profile_id === profile.id,
    ),
    'Shared profile assignments preserved',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No page overflow',
  );
  return { passed: true, checks };
})();

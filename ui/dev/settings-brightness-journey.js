(async () => {
  const key = 'zigbee2mqtt/living_room_lamp';
  const api = '/api/v1/config/calibration-editor';
  const fixture = '/api/__fixture/calibration';
  const response = await fetch(api);
  if (
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021' ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Use the isolated marked fixture on port 3021.');
  const before = (await response.json()).data;
  const results = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const until = async (test, message) => {
    for (let i = 0; i < 100; i++) {
      if (await test()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
    results.push(message);
  };
  const btn = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const region = () =>
    document.querySelector('[aria-label="Brightness calibration"]');
  const change = (el, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const saved = async () => (await (await fetch(api)).json()).data;
  const control = async (body) =>
    (
      await (
        await fetch(fixture, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json()
    ).data;
  const evidence = async () => (await (await fetch(fixture)).json()).data;
  await until(() => region(), 'Brightness editor opened');
  const manual = [...region().querySelectorAll('label')]
    .find((el) => el.textContent.includes('Enter a curve manually'))
    .querySelector('input');
  manual.click();
  await pause();
  btn('Continue').click();
  await until(
    () => document.querySelector('[aria-label="Target output for point 2"]'),
    'Points opened',
  );
  change(
    document.querySelector('[aria-label="Target output for point 2"]'),
    '',
  );
  await pause();
  assert(
    document.querySelector('[aria-label="Target output for point 2"]').value ===
      '' && btn('Review').disabled,
    'Incomplete numeric input is kept and prevents review',
  );
  change(
    document.querySelector('[aria-label="Target output for point 2"]'),
    '60',
  );
  await pause();
  assert(
    (await saved()).revision_token === before.revision_token,
    'Editing brightness does not write configuration',
  );
  btn('Close calibration').click();
  await until(() => !region(), 'Closed');
  btn('Calibrate brightness').click();
  await until(
    () => document.querySelector('[aria-label="Target output for point 2"]'),
    'Reopened draft',
  );
  assert(
    document.querySelector('[aria-label="Target output for point 2"]').value ===
      '60',
    'Closing and reopening retains point edits and wizard position',
  );
  btn('Preview this point').click();
  await until(
    async () => Object.keys((await evidence()).sessions).length === 1,
    'Preview started',
  );
  btn('Close calibration').click();
  await until(
    async () => Object.keys((await evidence()).sessions).length === 0,
    'Unmount restored preview',
  );
  const eventCount = (await evidence()).events.length;
  btn('Calibrate brightness').click();
  await until(() => region(), 'Draft reopened');
  await pause();
  assert(
    (await evidence()).events.length === eventCount,
    'Returning to a draft does not restart the live preview',
  );
  await control({ startDelay: 500 });
  const startsBefore = (await evidence()).events.filter(
    (row) => row.method === 'POST',
  ).length;
  const stopsBefore = (await evidence()).events.filter(
    (row) => row.method === 'DELETE',
  ).length;
  btn('Preview this point').click();
  await until(
    async () =>
      (await evidence()).events.filter((row) => row.method === 'POST').length >
      startsBefore,
    'Delayed start reached fixture',
  );
  btn('Close calibration').click();
  await until(async () => {
    const current = await evidence();
    return (
      current.events.filter((row) => row.method === 'DELETE').length >
        stopsBefore && Object.keys(current.sessions).length === 0
    );
  }, 'An in-flight preview start is cleaned up after leaving');
  assert(
    true,
    'Leaving during a pending preview start still restores the lights',
  );
  await control({});
  btn('Calibrate brightness').click();
  await until(() => region(), 'Returned after pending preview');
  // Follow a real related entity and return through the retained-draft link.
  document.querySelector('#details a').click();
  await until(
    () => location.pathname.includes('/config/integrations/'),
    'Related connection opened',
  );
  const retained = () =>
    [...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(
      (el) => el.textContent.includes('brightness calibration'),
    );
  await until(retained, 'Retained calibration link visible');
  retained().click();
  await until(
    () => document.querySelector('[aria-label="Target output for point 2"]'),
    'Draft returned',
  );
  assert(
    document.querySelector('[aria-label="Target output for point 2"]').value ===
      '60',
    'Related navigation retains the calibration draft',
  );
  btn('Preview this point').click();
  await until(
    async () => Object.keys((await evidence()).sessions).length === 1,
    'Preview restarted explicitly',
  );
  btn('Review').click();
  await until(() => btn('Save changes'), 'Review opened');
  await control({ failStop: true });
  const writesBefore = (await evidence()).events.filter(
    (row) => row.path === api,
  ).length;
  btn('Save changes').click();
  await until(
    () => document.body.textContent.includes('Fixture preview could not stop'),
    'Stop failure visible',
  );
  assert(
    (await evidence()).events.filter((row) => row.path === api).length ===
      writesBefore,
    'A failed preview stop prevents any calibration write',
  );
  await control({ failSave: true });
  btn('Retry save').click();
  await until(
    () => document.body.textContent.includes('Fixture database write failed'),
    'Save failure visible',
  );
  assert(
    (await saved()).profiles.length === before.profiles.length,
    'Failed combined save leaves no orphan profile',
  );
  await control({ changeColor: 0.215 });
  btn('Retry save').click();
  await until(() => btn('Review saved calibration'), 'Conflict offered');
  btn('Review saved calibration').click();
  await until(
    () => document.querySelector('[role="dialog"]'),
    'Conflict dialog opened',
  );
  assert(
    document
      .querySelector('[role="dialog"]')
      .textContent.includes('Shared color match'),
    'Conflict identifies the changed saved profile',
  );
  btn('Keep my edits with these saved values').click();
  await pause();
  (btn('Retry save') ?? btn('Save changes')).click();
  await until(
    () =>
      document.body.textContent.includes(
        'Brightness calibration saved and assigned',
      ),
    'Saved',
  );
  const after = await saved();
  const assigned = after.assignments.find(
    (row) => row.device_key === key,
  ).profile_id;
  const profile = after.profiles.find((row) => row.id === assigned);
  assert(
    profile.brightness_points.some(
      (row) => row.logical === 0.5 && row.output === 0.6,
    ) && profile.points[0].output.u === 0.215,
    'Reviewed save preserves local brightness and the latest saved color',
  );
  assert(
    after.assignments.find((row) => row.device_key !== key).profile_id ===
      'shared-color',
    'Other lights keep their shared profile',
  );
  const events = (await evidence()).events;
  assert(
    events.filter((row) => row.method === 'DELETE').length >= 2 &&
      Object.keys((await evidence()).sessions).length === 0,
    'Live previews are stopped before the successful save',
  );
  btn('Remove brightness calibration').click();
  await until(() => btn('Save changes'), 'Removal staged');
  assert(
    (await saved()).revision_token === after.revision_token,
    'Removing brightness is staged until Save',
  );
  btn('Save changes').click();
  await until(
    () => document.body.textContent.includes('Brightness calibration removed'),
    'Removal saved',
  );
  const removed = await saved();
  const colorOnly = removed.profiles.find(
    (row) =>
      row.id ===
      removed.assignments.find((row) => row.device_key === key).profile_id,
  );
  assert(
    colorOnly.brightness_points.length === 0 &&
      colorOnly.points[0].output.u === 0.215,
    'Removing brightness preserves color calibration',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'Phone and desktop page width stays within the viewport',
  );
  document.querySelector('#calibration').scrollIntoView({ block: 'start' });
  return { passed: results.length, results };
})();

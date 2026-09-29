(async () => {
  const endpoint = '/api/v1/config/calibration-editor';
  const response = await fetch(endpoint);
  if (
    location.origin !== 'http://127.0.0.1:3021' ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const baseline = (await response.json()).data;
  if (!baseline.profiles.length)
    throw Error('Seed calibration fixture before this journey');
  const profile = baseline.profiles[0];
  const keys = ['zigbee2mqtt/living_room_lamp', 'zigbee2mqtt/bedroom_lamp'];
  const read = async () => (await (await fetch(endpoint)).json()).data;
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === text,
    );
  const checks = [];
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
    checks.push(message);
  };
  const goto = async (path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    await pause();
  };
  const selectLights = async () => {
    for (const name of ['Living room lamp', 'Bedroom lamp']) {
      const checkbox = document.querySelector(`[aria-label="Select ${name}"]`);
      if (!checkbox || checkbox.disabled)
        throw Error('Missing eligible selection: ' + name);
      if (!checkbox.checked) checkbox.click();
      await pause();
    }
    button('Use 2 selected lights').click();
    await pause();
  };
  const operation = async (text) => {
    document
      .querySelector('[aria-label="Calibration change"]')
      .dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerType: 'mouse',
          button: 0,
        }),
      );
    await until(() => document.querySelector('[role="option"]'), 'Change menu');
    [...document.querySelectorAll('[role="option"]')]
      .find((e) => e.textContent.trim() === text)
      .click();
    await pause();
  };
  await goto('/config/devices?calibration=bulk');
  await until(
    () => document.querySelector('[aria-label="Bulk calibration profile"]'),
    'Bulk form ready',
  );
  await selectLights();
  await operation('Remove calibration');
  assert(
    (await read()).revision_token === baseline.revision_token,
    'Preparing bulk removal does not write',
  );
  await goto('/groups');
  await goto('/config/devices?calibration=bulk');
  await until(
    () => document.querySelector('[aria-label="Bulk calibration"]'),
    'Returned to retained draft',
  );
  assert(
    document
      .querySelector('[aria-label="Bulk calibration"]')
      .textContent.includes('2 lights in this change'),
    'Navigation retains the exact captured scope',
  );
  button('Discard').click();
  await pause();
  assert(
    document
      .querySelector('[aria-label="Bulk calibration"]')
      .textContent.includes('0 lights in this change') &&
      (await read()).revision_token === baseline.revision_token,
    'Discard clears the pending scope without changing assignments',
  );
  await selectLights();
  await operation('Remove calibration');
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Removal saved');
  const removed = await read();
  assert(
    !removed.assignments.some((a) => keys.includes(a.device_key)),
    'Save removes only the selected assignments',
  );
  assert(
    JSON.stringify(
      removed.assignments.filter((a) => !keys.includes(a.device_key)),
    ) ===
      JSON.stringify(
        baseline.assignments.filter((a) => !keys.includes(a.device_key)),
      ),
    'Unselected assignments stay unchanged',
  );
  await operation('Assign a profile');
  document.querySelector('[aria-label="Bulk calibration profile"]').click();
  await until(
    () => document.querySelector('[role="option"]'),
    'Profiles opened',
  );
  [...document.querySelectorAll('[role="option"]')]
    .find((e) => e.textContent.includes(profile.name))
    .click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Assignment saved');
  const assigned = await read();
  assert(
    keys.every((key) =>
      assigned.assignments.some(
        (a) => a.device_key === key && a.profile_id === profile.id,
      ),
    ),
    'Bulk Save assigns the selected profile to both lights',
  );
  assert(
    JSON.stringify(assigned.profiles) === JSON.stringify(baseline.profiles),
    'Bulk assignment preserves complete color and brightness profiles',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'Bulk controls fit the viewport',
  );
  return { passed: true, checks, width: innerWidth };
})();

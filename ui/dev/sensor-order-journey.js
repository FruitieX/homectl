(async () => {
  const path = '/api/v1/config/sensors/catalog';
  const response = await fetch(path);
  if (
    location.origin !== 'http://127.0.0.1:3021' ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Isolated fixture required');
  const original = (await response.json()).data;
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(message);
  };
  const checks = [];
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
    checks.push(message);
  };
  const click = (label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (!el) throw Error(label);
    el.click();
  };
  await until(
    () =>
      document.querySelector('[aria-label="Move sensor Living climate down"]'),
    'Seed catalog before running',
  );
  click('Move sensor Living climate down');
  await pause();
  click('Move group Indoor down');
  await pause();
  // Restrict to Indoor's group card so a shared sensor in another group is untouched.
  const indoor =
    document.querySelector('input[value="Indoor"]')?.closest('article') ??
    document.querySelector('input[value="Indoor"]')?.closest('.rounded-lg');
  const members = [
    ...document.querySelectorAll('[aria-label="Move Bedroom climate up"]'),
  ];
  assert(
    members.length === 2,
    'Shared members have independent ordering controls',
  );
  members.at(-1).click();
  await pause();
  const beforeSave = (await (await fetch(path)).json()).data;
  assert(
    JSON.stringify(beforeSave) === JSON.stringify(original),
    'Reordering stays in the unsaved page draft',
  );
  const save = [...document.querySelectorAll('button')].find(
    (el) => el.textContent.trim() === 'Save changes',
  );
  save.click();
  await until(
    () => !document.body.textContent.includes('Unsaved changes'),
    'Saved order',
  );
  const saved = (await (await fetch(path)).json()).data;
  assert(
    saved.sensors.map((s) => s.id).join(',') === 'bedroom,living,outdoor',
    'Sensor catalog order persists',
  );
  assert(
    saved.groups.map((g) => g.id).join(',') === 'all,indoor',
    'Sensor group order persists',
  );
  assert(
    saved.groups.find((g) => g.id === 'indoor').sensorIds.join(',') ===
      'bedroom,living',
    'Group member order persists',
  );
  assert(
    saved.groups.find((g) => g.id === 'all').sensorIds.join(',') ===
      'living,bedroom,outdoor',
    'Other group membership stays unchanged',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'Ordering controls fit the viewport',
  );
  return { passed: true, checks, width: innerWidth };
})();

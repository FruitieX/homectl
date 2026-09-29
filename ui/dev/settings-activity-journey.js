(async () => {
  const response = await fetch('/api/v1/config/routine-history');
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.origin !== 'http://127.0.0.1:3021'
  )
    throw Error('Use the isolated fixture.');
  const initial = (await response.json()).data;
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const until = async (fn, label) => {
    for (let n = 0; n < 180; n++) {
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
  const input = (el, value) => {
    Object.getOwnPropertyDescriptor(
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const configure = (body) =>
    fetch('/api/__fixture/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const rows = () => [...document.querySelectorAll('[data-activity-id]')];
  await until(() => rows().length === 2, 'Initial activity');
  assert(
    rows()[0].dataset.activityId === '9002',
    'Activity sorts by recorded time, newest first',
  );
  assert(
    rows().every((el) => !el.open && el.getBoundingClientRect().height < 95),
    'Outcomes are glanceable in compact closed rows',
  );
  input(document.querySelector('[aria-label="Activity outcome"]'), 'Blocked');
  await pause();
  assert(
    rows().length === 1 && rows()[0].textContent.includes('7 attempts'),
    'Blocked counts are visible without opening evidence',
  );
  rows()[0].querySelector('summary').click();
  await pause();
  assert(
    rows()[0].textContent.includes('No run outcome was recorded'),
    'Blocked attempts do not invent a dispatched run',
  );
  button('Clear filters').click();
  await pause();
  const run = structuredClone(initial.find((e) => e.id === '9001'));
  run.v2.last_run.steps[0].targets = [
    'normal',
    'zigbee2mqtt/living_room_lamp',
    'living_room',
  ];
  run.v2.last_run.steps[0].references = [
    { entity: 'scene', entity_id: 'normal' },
    { entity: 'device', entity_id: 'zigbee2mqtt/living_room_lamp' },
    { entity: 'group', entity_id: 'living_room' },
  ];
  await configure({ entries: [initial[0], run] });
  document.querySelector('[aria-label="Refresh activity"]').click();
  await until(
    () => document.querySelector('a[href="/config/scenes/normal"]'),
    'Typed references loaded',
  );
  document.querySelector('[data-activity-id="9001"] summary').click();
  await pause();
  assert(
    !!document.querySelector('a[href="/config/scenes/normal"]') &&
      !!document.querySelector('a[href="/config/groups/living_room"]'),
    'Recorded scene and room references have direct detail links',
  );
  const triggerLink = document.querySelector(
    'a[href="/config/routines/motion_on?node=t1"]',
  );
  triggerLink.click();
  await until(
    () => document.activeElement?.dataset.nodeId === 't1',
    'Trigger focus',
  );
  assert(
    document.activeElement.dataset.nodeId === 't1',
    'Recorded trigger opens and focuses the current routine block',
  );
  input(
    document.querySelector('[data-field="name"]'),
    'Pending activity review',
  );
  await pause();
  const activityLink = [...document.querySelectorAll('a')].find(
    (el) =>
      el.getAttribute('href') === '/config/routine-history?routine=motion_on',
  );
  activityLink.click();
  await until(
    () => document.querySelector('[aria-label="Routine filter"]'),
    'Return to activity',
  );
  assert(
    document.querySelector('[aria-label="Routine filter"]').value ===
      'motion_on',
    'Routine detail links filter activity by exact routine ID',
  );
  const retained = document.querySelector(
    '[aria-label="Retained drafts"] a[href="/config/routines/motion_on"]',
  );
  assert(
    !!retained,
    'Activity navigation keeps the routine draft discoverable',
  );
  retained.click();
  await until(
    () =>
      document.querySelector('[data-field="name"]')?.value ===
      'Pending activity review',
    'Retained routine value',
  );
  assert(
    document.querySelector('[data-field="name"]').value ===
      'Pending activity review',
    'Returning restores the pending routine value',
  );
  [...document.querySelectorAll('a')]
    .find(
      (el) =>
        el.getAttribute('href') === '/config/routine-history?routine=motion_on',
    )
    .click();
  await until(
    () => document.querySelector('[aria-label="Routine filter"]'),
    'Return to filtered activity',
  );
  button('Clear filters').click();
  await pause();
  button('Pause').click();
  await pause();
  await configure({
    entries: [
      ...initial,
      {
        ...run,
        id: 'new-record',
        routine_id: 'other_routine',
        routine_name: 'Other routine',
        timestamp: new Date().toISOString(),
      },
    ],
  });
  await new Promise((r) => setTimeout(r, 5400));
  assert(
    rows().length === 2,
    'Paused activity stays stable while new records arrive',
  );
  button('Resume').click();
  await until(() => rows().length === 3, 'Resumed activity');
  assert(
    rows()[0].dataset.activityId === 'new-record',
    'Resuming shows fresh records',
  );
  input(document.querySelector('[aria-label="Routine filter"]'), 'motion_on');
  await pause();
  assert(
    rows().length === 2 &&
      new URLSearchParams(location.search).get('routine') === 'motion_on',
    'Exact routine filters exclude unrelated activity and stay in the URL',
  );
  await configure({ fail: true });
  document.querySelector('[aria-label="Refresh activity"]').click();
  await until(
    () =>
      document
        .querySelector('[role="alert"]')
        ?.textContent.includes('unavailable'),
    'Read failure',
  );
  assert(
    rows().length === 2,
    'Failed refresh preserves the last successful activity',
  );
  await configure({
    entries: Array.from({ length: 205 }, (_, i) => ({
      ...run,
      id: `many-${i}`,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    })),
  });
  button('Retry').click();
  await until(() => rows().length === 100, 'Bounded history');
  assert(
    rows().length === 100 && !!button('Show more (105 remaining)'),
    'Large activity lists render a bounded first page',
  );
  button('Show more (105 remaining)').click();
  await pause();
  assert(rows().length === 200, 'Show more reveals the next bounded page');
  input(
    document.querySelector('[aria-label="Search activity"]'),
    'unmatched phrase',
  );
  await pause();
  assert(
    rows().length === 0 &&
      document.body.textContent.includes('No recorded attempts match'),
    'Empty filtered results do not imply no trigger activity',
  );
  button('Clear filters').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Activity fits the viewport',
  );
  return { passed: true, checks };
})();

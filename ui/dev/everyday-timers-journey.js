(async () => {
  const base = '/api/v1/config/timers';
  const marker = await fetch(base);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Isolated fixture required');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, m) => {
    for (let i = 0; i < 150; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(m);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === text,
    );
  const fields = (text) =>
    [...document.querySelectorAll('label')]
      .filter((l) => l.querySelector('span')?.textContent === text)
      .map((l) => l.querySelector('input,select'));
  const set = (el, value) => {
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
  const goto = async (path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    await pause();
  };
  const read = async () => (await (await fetch(base)).json()).data;
  await goto('/config/timers');
  await until(
    () => button('Add timer') && !button('Add timer').disabled,
    'Timer editor ready',
  );
  const before = await read();
  button('Add timer').click();
  await until(
    () =>
      location.search.includes('timer=') &&
      fields('Name')[0]?.value === 'New timer',
    'New timer selected',
  );
  const returnPath = location.pathname + location.search;
  const name = `Morning warmth ${Date.now()}`;
  set(fields('Name')[0], name);
  await pause();
  set(fields('Timer mode')[0], 'ready_by');
  await pause();
  assert(
    fields('Time zone')[0].value === 'Europe/Helsinki',
    'New schedules default to Helsinki',
  );
  set(fields('Icon')[0], 'coffee');
  await pause();
  set(fields('Target')[0], 'zigbee2mqtt/living_room_lamp');
  await pause();
  set(fields('Target')[1], 'zigbee2mqtt/living_room_lamp');
  await pause();
  set(fields('Ready by')[0], '08:30');
  await pause();
  set(fields('Warm up for (minutes)')[0], '35');
  await pause();
  assert(
    (await read()).timers.length === before.timers.length,
    'Editing does not write schedules',
  );
  assert(
    document.body.textContent.includes('Unsaved changes'),
    'Explicit unsaved indicator',
  );
  const link = [...document.querySelectorAll('a')].find(
    (a) => a.textContent === 'Open target details',
  );
  assert(
    link?.getAttribute('href') ===
      '/config/devices/detail/zigbee2mqtt/living_room_lamp',
    'Timer target links use canonical device detail',
  );
  link.click();
  await pause();
  await goto(returnPath);
  await until(
    () => fields('Name').some((i) => i.value === name),
    'Draft restored',
  );
  assert(
    fields('Warm up for (minutes)')[0].value === '35',
    'Navigation retains unsaved timer fields',
  );
  button('Save changes').click();
  await until(
    async () => (await read()).timers.some((t) => t.definition.name === name),
    'Timer saved',
  );
  const saved = (await read()).timers.find((t) => t.definition.name === name);
  assert(
    saved.definition.icon === 'coffee' &&
      saved.definition.schedule.timezone === 'Europe/Helsinki' &&
      saved.definition.schedule.warmup_minutes === 35,
    'Name icon and schedule persist',
  );
  assert(
    saved.definition.action.device_key ===
      saved.definition.finish_action.device_key && !saved.definition.enabled,
    'Explicit start/end targets and disabled default persist',
  );
  await until(() => !button('Save changes'), 'Save settled');
  set(fields('Timer mode')[0], 'countdown');
  await pause();
  set(fields('Target type')[0], 'scene');
  await pause();
  const scene = fields('Target')[0].options[1].value;
  set(fields('Target')[0], scene);
  await pause();
  assert(
    fields('Wait for (minutes)').length === 1 &&
      fields('Warm up for (minutes)').length === 0,
    'Countdown has one expiry action',
  );
  button('Discard').click();
  await pause();
  assert(
    fields('Timer mode')[0].value === 'ready_by',
    'Discard restores saved schedule',
  );
  set(fields('Timer mode')[0], 'scheduled');
  await pause();
  set(fields('Target type')[0], 'group');
  await pause();
  const group = fields('Target')[0].options[1].value;
  set(fields('Target')[0], group);
  await pause();
  assert(
    fields('Start time').length === 1 &&
      document.body.textContent.includes('Run an end action after a duration'),
    'Scheduled mode supports room target and optional end action',
  );
  button('Discard').click();
  await pause();
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal overflow',
  );
  return { checks, width: innerWidth, timer: saved.definition };
})();

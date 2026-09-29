(async () => {
  const marker = await fetch('/api/__fixture/assistant');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Isolated fixture required');
  const checks = [],
    pause = () => new Promise((r) => setTimeout(r, 120));
  const until = async (fn, m) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(m);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const button = (t) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === t,
    );
  const evidence = async () =>
    (await (await fetch('/api/__fixture/assistant')).json()).data;
  await until(
    () => document.querySelector('[aria-label="Ask AI"]'),
    'Assistant entry',
  );
  document.querySelector('[aria-label="Ask AI"]').click();
  await until(() => document.querySelector('textarea'), 'Prompt field');
  const prompt = document.querySelector('textarea');
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  ).set.call(prompt, 'Dim the living room lights');
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
  button('Send').click();
  await until(
    () =>
      document.querySelectorAll('[role="checkbox"][aria-label^="Apply change"]')
        .length === 2,
    'Two proposed targets',
  );
  assert(
    (await evidence()).length === 0,
    'Proposal writes nothing before Apply',
  );
  assert(
    document.body.textContent.includes('Current') &&
      document.body.textContent.includes('Proposed'),
    'State previews are labelled',
  );
  const boxes = () => [
    ...document.querySelectorAll(
      '[role="checkbox"][aria-label^="Apply change"]',
    ),
  ];
  const floor = boxes().find((b) =>
    b.getAttribute('aria-label').toLowerCase().includes('floor'),
  );
  floor.click();
  await pause();
  assert(
    button('Apply 1 change') && !button('Apply 1 change').disabled,
    'Explicit selected-device count',
  );
  button('Apply 1 change').click();
  await until(
    () => document.body.textContent.includes('1 not included'),
    'Subset result',
  );
  assert(
    JSON.stringify((await evidence()).at(-1)) ===
      JSON.stringify(['zigbee2mqtt/living_room_lamp']),
    'Unchecked device excluded from API request',
  );
  assert(
    document.body.textContent.includes('Not included in the last application'),
    'Unselected rows are not marked applied',
  );
  boxes()
    .find((b) => b.getAttribute('aria-label').toLowerCase().includes('floor'))
    .click();
  await pause();
  button('Apply 2 again').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Fixture integration rejected the command',
      ),
    'Partial failure rendered',
  );
  assert(
    document.body.textContent.includes('1 applied · 1 failed'),
    'Outcome reports success and failure separately',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No page overflow',
  );
  const link = [...document.querySelectorAll('a')].find(
    (a) =>
      a.getAttribute('href') ===
      '/config/devices/detail/zigbee2mqtt/living_room_lamp',
  );
  assert(!!link, 'Canonical target link');
  link.click();
  await until(
    () => location.pathname.includes('/config/devices/detail'),
    'Target detail opened',
  );
  await until(
    () =>
      !document.querySelector('[role="checkbox"][aria-label^="Apply change"]'),
    'Assistant panel closes after target navigation',
  );
  assert(
    !document.querySelector('[role="checkbox"][aria-label^="Apply change"]'),
    'Opening a target closes the assistant panel',
  );
  document.querySelector('[aria-label="Ask AI"]').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Fixture integration rejected the command',
      ),
    'Thread retained',
  );
  return { checks, width: innerWidth };
})();

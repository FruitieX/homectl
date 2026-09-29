(async () => {
  const key = 'zigbee2mqtt/bedroom_switch';
  const marker = await fetch('/api/v1/config/device-health');
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [],
    pause = () => new Promise((resolve) => setTimeout(resolve, 200));
  const until = async (predicate, message) => {
    for (let i = 0; i < 80; i++) {
      if (predicate()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
    checks.push(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const input = (el, value) => {
    if (!el) throw Error('Missing input');
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
  const saved = async () =>
    (
      await (
        await fetch(
          '/api/v1/config/device-settings?device_key=' +
            encodeURIComponent(key),
        )
      ).json()
    ).data;
  const health = async () =>
    (await (await fetch('/api/v1/config/device-health')).json()).data;
  const save = async () => {
    await until(() => button('Save changes'), 'Save available');
    button('Save changes').click();
    await until(() => !button('Save changes'), 'Save completed');
  };
  const go = async (href) => {
    const link = [...document.querySelectorAll('a')].find(
      (el) => el.getAttribute('href') === href && el.offsetParent !== null,
    );
    if (!link) throw Error('Missing link ' + href);
    link.click();
    await until(
      () => location.pathname + location.search === href,
      'Navigation completed',
    );
  };
  await until(
    () => document.querySelector('[data-field=reporting_policy]'),
    'Integration policy ready',
  );
  input(document.querySelector('[data-field=reporting_policy]'), 'custom');
  await pause();
  input(
    document.querySelector(
      '[aria-label="Expected reporting interval (seconds)"]',
    ),
    '60',
  );
  await save();
  assert(
    (await health()).devices[key].effective_policy.source === 'integration',
    'Saved integration default reaches inheriting devices',
  );
  await go('/config/devices/detail/' + key);
  await until(
    () =>
      document.querySelector('#live') &&
      document.querySelector('[data-field=reporting_policy]'),
    'Device ready',
  );
  assert(
    document.querySelector('[data-field=reporting_policy]').value === 'inherit',
    'Device shows inheritance directly',
  );
  input(document.querySelector('[data-field=reporting_policy]'), 'custom');
  await pause();
  input(
    document.querySelector(
      '[aria-label="Expected reporting interval (seconds)"]',
    ),
    '120',
  );
  await pause();
  assert(
    (await saved()).reporting_policy.mode === 'inherit',
    'Editing a reporting policy does not save implicitly',
  );
  input(document.querySelector('[data-field=reporting_policy]'), 'ignore');
  await pause();
  input(document.querySelector('[data-field=reporting_policy]'), 'custom');
  await pause();
  assert(
    document.querySelector(
      '[aria-label="Expected reporting interval (seconds)"]',
    ).value === '120',
    'Switching policy modes retains the custom interval',
  );
  await save();
  assert(
    (await health()).devices[key].effective_policy.policy
      .expected_interval_seconds === 120,
    'Saved device override wins over the integration default',
  );
  const evidence = await fetch('http://127.0.0.1:45921/__health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      [key]: { offline: true, last_fresh_report_ms: Date.now() - 600000 },
    }),
  });
  if (!evidence.ok) throw Error('Synthetic evidence injection failed');
  const snapshot = await health();
  assert(
    snapshot.devices[key].issues.length === 2 &&
      snapshot.attention_device_keys.filter((value) => value === key).length ===
        1,
    'Multiple issues on one device count once',
  );
  await until(
    () =>
      document
        .querySelector('#live')
        ?.innerText.includes('was reported offline'),
    'Health polling displays synthetic evidence',
  );
  input(document.querySelector('[data-field=reporting_policy]'), 'ignore');
  await save();
  await until(
    () =>
      document
        .querySelector('#live')
        ?.innerText.includes('Ignore missing reports') &&
      !document
        .querySelector('#live')
        ?.innerText.includes('has not reported since'),
    'Ignore applied to saved evidence',
  );
  assert(
    document.querySelector('#live').innerText.includes('was reported offline'),
    'Ignore suppresses silence while keeping explicit offline evidence visible',
  );
  const logHref = '/config/logs?device=' + encodeURIComponent(key);
  await go(logHref);
  await until(
    () =>
      [...document.querySelectorAll('.settings-log-row')].some((el) =>
        el.textContent.includes('was reported offline'),
      ),
    'Linked log loaded',
  );
  const logButton = [...document.querySelectorAll('main button')].find((el) =>
    el.textContent.includes('was reported offline'),
  );
  logButton.click();
  await until(
    () => document.querySelector('[role=dialog]'),
    'Event details opened',
  );
  assert(
    Boolean(
      document.querySelector(
        `[role=dialog] a[href="/config/devices/detail/${key}"]`,
      ),
    ),
    'Structured log details link back to the affected device',
  );
  assert(
    ![
      ...document.querySelectorAll('[role=dialog] input, [role=dialog] a'),
    ].some((el) => el.getBoundingClientRect().right > innerWidth + 1),
    'Log event links fit the viewport',
  );
  const deviceLink = document.querySelector(
    `[role=dialog] a[href="/config/devices/detail/${key}"]`,
  );
  deviceLink.click();
  await until(() => document.querySelector('#live'), 'Returned to device');
  assert(
    document.querySelector('[data-field=reporting_policy]').value === 'ignore',
    'Related-log navigation returns to the saved device policy',
  );
  document.querySelector('#reporting').scrollIntoView({ block: 'start' });
  return { passed: true, checks };
})();

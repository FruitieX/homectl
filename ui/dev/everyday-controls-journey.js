(async () => {
  const endpoint = '/api/__fixture/live-controls';
  const marker = await fetch(endpoint);
  if (
    marker.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use isolated fixture.');
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, msg) => {
    for (let i = 0; i < 150; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(msg);
  };
  const assert = (v, m) => {
    if (!v) throw Error(m);
    checks.push(m);
  };
  const fixture = async (value) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const commands = async () => (await (await fetch(endpoint)).json()).commands;
  await fixture({ clear: true, reject: false, delay: 700 });
  await until(
    () => document.querySelector('[aria-label="Turn Living room lamp off"]'),
    'Room ready',
  );
  document.querySelector('[aria-label="Turn Living room lamp off"]').click();
  await until(
    () =>
      document.querySelector('[aria-label="Turn Living room lamp off"]')
        ?.disabled,
    'Pending power',
  );
  assert(
    document.querySelector('[aria-label="Turn Living room lamp off"]')
      ?.disabled,
    'Power control shows pending until runtime outcome',
  );
  await until(
    () => document.querySelector('[aria-label="Turn Living room lamp on"]'),
    'Power result reflected',
  );
  let sent = await commands();
  assert(
    sent[0].DeviceCommand.device_key === 'zigbee2mqtt/living_room_lamp' &&
      sent[0].DeviceCommand.power === false,
    'Power command uses selected device',
  );
  assert(
    sent[0].DeviceCommand.color === null &&
      sent[0].DeviceCommand.brightness === null,
    'Power leaves color and brightness unchanged',
  );
  document.querySelector('[aria-label="Activate Normal"]').click();
  await until(
    () => document.querySelector('[aria-label="Turn Living room lamp off"]'),
    'Scene result reflected',
  );
  sent = await commands();
  const scene = sent.find((x) => x.SceneCommand)?.SceneCommand;
  assert(
    scene.device_keys.length === 2 &&
      scene.device_keys.includes('zigbee2mqtt/living_room_lamp'),
    'Scene activation constrained to this room',
  );
  await fixture({ reject: true });
  document.querySelector('[aria-label="Turn Living room lamp off"]').click();
  await until(
    () =>
      document.body.textContent.includes(
        'Fixture runtime rejected this command.',
      ),
    'Rejection shown',
  );
  assert(
    Boolean(document.querySelector('[aria-label="Turn Living room lamp off"]')),
    'Rejected power command leaves state unchanged',
  );
  await fixture({ reject: false });
  assert(
    document.documentElement.scrollWidth <= innerWidth + 1,
    'No horizontal overflow',
  );
  return { passed: true, checks };
})();

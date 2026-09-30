import { writeFile } from 'node:fs/promises';

export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/dashboard';
  const marker = await fetch(base + '/layouts');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const ids = [],
    checks = [];
  let writes = 0,
    commands = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url.startsWith(base) && request.method === 'POST') writes++;
    if (
      request.method === 'POST' &&
      /\/(activate|commands|force-trigger)(\/|$)/.test(
        new URL(request.url).pathname,
      )
    )
      commands++;
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const message = JSON.parse(response.payloadData);
      if (message.DeviceCommand || message.SceneCommand || message.Action)
        commands++;
    } catch {}
  });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const label = (text) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + text + '"]')})`;
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target '+${JSON.stringify(expression)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        clickCount: 1,
      });
    await pause();
  };
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
    await pause();
  };
  const type = async (name, value) => {
    await click(label(name));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (name, text) => {
    await click(label(name));
    await until(
      "!!document.querySelector('[data-radix-select-viewport] [role=option]')",
      'Options open',
    );
    const index = await evaluate(
      `[...document.querySelectorAll('[data-radix-select-viewport] [role=option]')].findIndex(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
    if (index < 0) throw Error('Missing option ' + text);
    await key('Home', 36);
    for (let i = 0; i < index; i++) await key('ArrowDown', 40);
    await key('Enter', 13);
    await until(
      "!document.querySelector('[data-radix-select-viewport]')",
      'Options closed',
    );
  };
  const choose = async (name, text) => {
    await click(label(name));
    await until("!!document.querySelector('[cmdk-item]')", 'Picker open');
    await click(
      `[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(${JSON.stringify(text)}))`,
    );
  };
  const assert = (name, ok) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const check = async (name, expression) =>
    assert(name, await evaluate(expression));
  const create = async (kind, options) => {
    const r = await fetch(base + '/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 0,
        layout_id: 1,
        widget_type: kind,
        config: {
          title: 'Option review ' + kind,
          options: { ...options, future: { keep: [false, null] } },
        },
        grid_x: 0,
        grid_y: 0,
        grid_w: 4,
        grid_h: 3,
        sort_order: 0,
      }),
    });
    const result = await r.json();
    if (!result.success) throw Error(JSON.stringify(result));
    ids.push(result.data.id);
    return result.data.id;
  };
  const read = async (id) =>
    (await (await fetch(base + '/layouts/1/widgets')).json()).data.find(
      (row) => row.id === id,
    ).config.options;
  const goto = async (id) => {
    const route = '/config/dashboard/1/widgets/' + id;
    await evaluate(
      `history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await until(
      "!!document.querySelector('#widget-options') && document.querySelector('input[data-field=title]').value===" +
        JSON.stringify('Option review ' + kinds.get(id)),
      'Widget ready',
    );
  };
  const kinds = new Map();
  const add = async (kind, options) => {
    const id = await create(kind, options);
    kinds.set(id, kind);
    return id;
  };
  const save = async () => {
    await click(button('Save changes'));
    await until('!' + button('Discard'), 'Saved');
  };
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/widget-options-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  try {
    const train = await add('train_schedule', {}),
      spot = await add('spot_price', {}),
      scene = await add('scenes', {
        scope: 'group',
        groupId: 'missing-room',
        sceneSelection: 'selected',
        sceneIds: ['missing-scene'],
      }),
      climate = await add('indoor_climate', {
        range: '-48h',
        temperatureSensorId: 'missing-temperature',
        humiditySensorId: 'missing-humidity',
      }),
      sensors = await add('sensors', {
        sensorIds: ['missing-sensor'],
        primarySensorId: 'missing-sensor',
      }),
      timers = await add('timers', {
        timerSelection: 'selected',
        timerIds: ['missing-timer'],
      });
    await goto(train);
    await check(
      'Omitted train options show established defaults',
      label('Walk minutes') +
        '.value==="12" && ' +
        label('Direction') +
        '.textContent.includes("Both directions")',
    );
    await type('Walk minutes', '');
    const before = writes;
    await click(button('Save changes'));
    await check(
      'Incomplete number blocks Save and focuses its field',
      'document.activeElement===' +
        label('Walk minutes') +
        ' && ' +
        label('Walk minutes') +
        '.validity.valueMissing',
    );
    assert('Incomplete numeric draft issues no write', writes === before);
    await shot('invalid-number');
    await type('Walk minutes', '0');
    await pick('Direction', 'Direction 1');
    await type('Departures visible in card', '7');
    await save();
    let saved = await read(train);
    assert(
      'Explicit Save persists zero, direction and count',
      saved.walkMinutes === 0 &&
        saved.directionId === '1' &&
        saved.displayLimit === 7,
    );
    assert(
      'Unedited defaults stay omitted and extension data survives',
      !('limit' in saved) &&
        JSON.stringify(saved.future) === '{"keep":[false,null]}',
    );
    await pick('Direction', 'Both directions');
    await save();
    assert(
      'Both directions saves the established empty-string representation',
      (await read(train)).directionId === '',
    );
    await goto(spot);
    await type('Low price threshold', '-1.25');
    await type('Medium price threshold', '0');
    await type('High price threshold', '8.5');
    await save();
    saved = await read(spot);
    assert(
      'Price thresholds accept signed decimals and explicit zero',
      saved.lowPriceThreshold === -1.25 &&
        saved.mediumPriceThreshold === 0 &&
        saved.highPriceThreshold === 8.5,
    );
    await goto(scene);
    await check(
      'Missing selected scene and room remain visible for repair',
      "document.querySelector('#widget-options').textContent.includes('missing-scene') && " +
        label('Group') +
        ".textContent.includes('missing-room (unavailable)')",
    );
    await choose('Group', 'Living room');
    await click(label('Remove missing-scene'));
    await save();
    saved = await read(scene);
    assert(
      'Unavailable references can be repaired without widening selection',
      saved.groupId === 'living_room' &&
        saved.sceneSelection === 'selected' &&
        saved.sceneIds.length === 0,
    );
    await pick('Activation scope', 'Selected devices');
    await save();
    saved = await read(scene);
    assert(
      'Changing scope preserves the inactive room draft',
      saved.scope === 'devices' && saved.groupId === 'living_room',
    );
    await goto(climate);
    await check(
      'Custom history range and unavailable sources stay explicit',
      label('History range') +
        '.textContent.includes("-48h · Custom") && ' +
        label('Humidity sensor') +
        '.textContent.includes("missing-humidity")',
    );
    await choose('Humidity sensor', 'Clear selection');
    await pick('History range', '7 days');
    await save();
    saved = await read(climate);
    assert(
      'Clearing humidity restores temperature fallback without clearing temperature',
      saved.humiditySensorId === '' &&
        saved.temperatureSensorId === 'missing-temperature' &&
        saved.range === '-7d',
    );
    await goto(sensors);
    await check(
      'Legacy nonempty sensor IDs imply selected mode',
      label('Sensors shown') + '.textContent.includes("Selected sensors")',
    );
    await check(
      'Missing primary sensor remains visible',
      label('Header sensor') + '.textContent.includes("missing-sensor")',
    );
    await choose('Header sensor', 'Clear selection');
    await pick('Sensors shown', 'All enabled sensors');
    await save();
    saved = await read(sensors);
    assert(
      'All sensor mode preserves selected IDs for a later switch',
      saved.sensorSelection === 'all' &&
        saved.sensorIds[0] === 'missing-sensor' &&
        saved.primarySensorId === '',
    );
    await goto(timers);
    await check(
      'Missing timer selection remains visible',
      "document.querySelector('#widget-options').textContent.includes('missing-timer')",
    );
    await pick('Timers shown', 'All timers');
    await pick('Timers shown', 'Selected timers');
    await check(
      'Timer selection survives mode switches',
      "document.querySelector('#widget-options').textContent.includes('missing-timer')",
    );
    if (await evaluate('!!' + button('Discard')))
      await click(button('Discard'));
    await goto(scene);
    await pick('Activation scope', 'Room or group');
    await check(
      'Room choice restores when switching scope',
      label('Group') + '.textContent.includes("Living room")',
    );
    await shot('scope');
    await click(button('Discard'));
    await goto(spot);
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until('!!' + label('Low price threshold'), 'Reloaded');
    await check(
      'Saved decimal thresholds reload exactly',
      label('Low price threshold') +
        '.value==="-1.25" && ' +
        label('High price threshold') +
        '.value==="8.5"',
    );
    await click(label('Low price threshold'));
    await shot('thresholds');
    await check(
      'Widget options fit viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    await check(
      'Option controls use shared selectors',
      "!document.querySelector('#widget-options select')",
    );
    assert('Authoring and previews issue no live commands', commands === 0);
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    for (const id of ids)
      await fetch(base + '/widgets/' + id, { method: 'DELETE' });
  }
}

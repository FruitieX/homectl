import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/scenes',
    id = 'scene-repair-' + width;
  const response = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  if ((await response.json()).data.some((s) => s.id === id))
    throw Error('Review ID already exists');
  const nullKey = 'esphome/kitchen_counter',
    badKey = 'zigbee2mqtt/living_room_lamp',
    validKey = 'zigbee2mqtt/living_room_floor_lamp';
  const seed = {
    id,
    name: 'Scene repair review',
    hidden: false,
    group_states: {},
    device_states: {
      [nullKey]: null,
      [badKey]: { color: { future: 123 }, future: { keep: [false, null, 0] } },
      [validKey]: {
        power: false,
        brightness: 0,
        transition: null,
        future: { keep: true },
      },
    },
  };
  const request = async (method, body) => {
    const r = await fetch(base + (method === 'POST' ? '' : '/' + id), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok || !j.success) throw Error(JSON.stringify(j));
    return j.data;
  };
  const saved = async () =>
    (await (await fetch(base)).json()).data.find((s) => s.id === id);
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
  const until = async (expr, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(message);
  };
  const checks = [],
    exceptions = [];
  let writes = 0,
    commands = 0;
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method === 'PUT' && request.url === base + '/' + id) writes++;
    if (request.method === 'POST' && /commands|activate/.test(request.url))
      commands++;
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const j = JSON.parse(response.payloadData);
      if (j.DeviceCommand || j.SceneCommand || j.Action) commands++;
    } catch {}
  });
  const check = async (name, value) => {
    if (!value) throw Error(name);
    checks.push({ name, passed: true });
  };
  const button = (text, root = 'document') =>
    '[' +
    root +
    ".querySelectorAll('button')].flatMap(x=>[...x]).find(e=>e.textContent.trim()===" +
    JSON.stringify(text) +
    ')';
  const row = (key) =>
    "document.querySelector('[data-target-key=" + JSON.stringify(key) + "]')";
  const field = "document.querySelector('[data-field=name]')";
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
      });
    await pause();
  };
  const activate = async (expr) => {
    await evaluate(expr + '.focus()');
    await key('Enter', 13);
  };
  const type = async (expr, text) => {
    await evaluate(expr + '.focus()');
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      '/tmp/scene-repair-' + width + '-' + name + '.png',
      Buffer.from(data, 'base64'),
    );
  };
  const reload = async () => {
    let done;
    const p = new Promise((r) => (done = r));
    cdp.on('Page.loadEventFired', () => done());
    await cdp.send('Page.reload');
    await p;
    await until('!!' + field, 'Editor reload');
  };
  const save = async () => {
    await activate(button('Save changes'));
    await until('!' + button('Save changes'), 'Saved');
    await reload();
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  await request('POST', seed);
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', { url: origin + '/config/scenes' });
    await until(
      '!!document.querySelector(\'a[href="/config/scenes/' + id + '"]\')',
      'Scene list loads malformed targets',
    );
    await check(
      'Scene list remains usable with malformed target JSON',
      exceptions.length === 0,
    );
    await activate(
      'document.querySelector(\'a[href="/config/scenes/' + id + '"]\')',
    );
    await until('!!' + row(nullKey), 'Scene targets loaded');
    await check(
      'Null and unknown color have explicit repair rows',
      await evaluate(
        row(nullKey) +
          ".textContent.includes('not a state or link object')&&" +
          row(badKey) +
          ".textContent.includes('unknown or incomplete channels')",
      ),
    );
    await activate(row(nullKey) + ".querySelector('summary')");
    await check(
      'Saved null remains inspectable',
      await evaluate(
        row(nullKey) + ".querySelector('pre').textContent==='null'",
      ),
    );
    await check(
      'No guessed state controls for malformed targets',
      await evaluate(
        '!' +
          row(nullKey) +
          ".querySelector('[role=combobox]')&&!" +
          row(badKey) +
          ".querySelector('[role=combobox]')",
      ),
    );
    await shot('repair');
    await check(
      'Repair rows fit the page',
      await evaluate(
        "[...document.querySelectorAll('.scene-target-row')].every(e=>e.scrollWidth<=e.clientWidth+1)",
      ),
    );
    await type(field, 'Name changed with raw values intact');
    await save();
    await check(
      'Unrelated save preserves raw null, color and extension values',
      same((await saved()).device_states, seed.device_states),
    );
    // Confirming an unchanged multi-selection must not replace null with {}.
    await activate(button('Add devices'));
    await until("!!document.querySelector('[role=dialog]')", 'Picker');
    await activate(button('Done'));
    await check(
      'Unchanged selection preserves null repair row',
      await evaluate(
        row(nullKey) + ".textContent.includes('not a state or link object')",
      ),
    );
    await check('Unchanged selection does not write', writes === 1);
    await activate(button('Replace with state', row(nullKey)));
    await until(
      "!!document.querySelector('[role=alertdialog]')",
      'Replacement review',
    );
    await activate(
      button('Cancel', "document.querySelector('[role=alertdialog]')"),
    );
    await check(
      'Cancel keeps the raw definition',
      await evaluate(
        row(nullKey) + ".textContent.includes('not a state or link object')",
      ),
    );
    await check(
      'Cancel restores focus to the repair action',
      await evaluate(
        'document.activeElement===' +
          button('Replace with state', row(nullKey)),
      ),
    );
    await activate(button('Replace with state', row(nullKey)));
    await until(
      "!!document.querySelector('[role=alertdialog]')",
      'Replacement review again',
    );
    await activate(
      button(
        'Replace with state',
        "document.querySelector('[role=alertdialog]')",
      ),
    );
    await until(
      '!!' + row(nullKey) + ".querySelector('[role=combobox]')",
      'State controls',
    );
    await check(
      'Replacement is staged, not saved',
      (await saved()).device_states[nullKey] === null && writes === 1,
    );
    await check(
      'Replacement focuses the new state controls',
      await evaluate(
        'document.activeElement===' +
          row(nullKey) +
          ".querySelector('[role=combobox]')",
      ),
    );
    await activate(button('Discard'));
    await check(
      'Discard restores unsupported raw definition',
      await evaluate(
        row(nullKey) + ".textContent.includes('not a state or link object')",
      ),
    );
    await activate(button('Replace with state', row(nullKey)));
    await until(
      "!!document.querySelector('[role=alertdialog]')",
      'Replacement final review',
    );
    await activate(
      button(
        'Replace with state',
        "document.querySelector('[role=alertdialog]')",
      ),
    );
    await until(
      '!!' + row(nullKey) + ".querySelector('[role=combobox]')",
      'State controls again',
    );
    await save();
    await check(
      'Explicit replacement persists only the chosen target',
      same((await saved()).device_states, {
        ...seed.device_states,
        [nullKey]: {},
      }),
    );
    await activate(button('Remove target', row(badKey)));
    await save();
    await check(
      'Explicit removal persists and preserves valid siblings',
      same((await saved()).device_states, {
        [nullKey]: {},
        [validKey]: seed.device_states[validKey],
      }),
    );
    await shot('repaired');
    await check(
      'No live commands or page exceptions',
      commands === 0 && exceptions.length === 0,
    );
    return {
      passed: true,
      checks,
      scope:
        'Temporary synthetic scene; exact API payload preservation and reload, no household edits',
    };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await request('DELETE');
  }
}

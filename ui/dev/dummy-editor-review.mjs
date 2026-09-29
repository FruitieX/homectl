import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/integrations';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `dummy-review-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'dummy',
    enabled: false,
    config: {
      devices: {
        reading: {
          name: 'Test reading',
          init_state: { Sensor: { value: false, future: [0, null] } },
        },
        light: {
          name: 'Test lamp',
          init_state: {
            Controllable: {
              state: { power: false, brightness: 0 },
              capabilities: {
                brightness: false,
                ct: { start: 2300, end: 6100 },
              },
            },
          },
        },
        nullable: { name: 'Default lamp', init_state: null },
      },
    },
  };
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initial),
  });
  if (!created.ok) throw Error('Fixture create failed');
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
  const until = async (expr, name) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label, tag = '') =>
    `document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)})`;
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr}; if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const key = async (key, code, modifiers = 0) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
  };
  const type = async (label, value) => {
    await click(labeled(label, 'input'));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (label, text, device = 'reading') => {
    await click(control(device, label, 'button'));
    await until(`!!document.querySelector('[role=option]')`, 'Type options');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const goto = async (route) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const read = async () =>
    (await (await fetch(base)).json()).data.find((row) => row.id === id);
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/dummy-editor-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  const row = (id) => `document.querySelector('[data-dummy-device="${id}"]')`;
  const control = (id, label, tag = 'input') =>
    `${row(id)}?.querySelector(${JSON.stringify(tag + '[aria-label="' + label + '"]')})`;
  const typeControl = async (id, label, value) => {
    await click(control(id, label));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const save = async () => {
    await click(button('Save changes'));
    await until(`!${button('Discard')}`, 'Save acknowledged');
  };
  const assert = (name, condition) => {
    if (!condition) throw Error(name);
    checks.push({ name, passed: true });
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(`!!${row('reading')}`, 'Reloaded');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${control('reading', 'Sensor reading type', 'button')}`,
      'Typed dummy sensor',
    );
    await check(
      'Null initial state displays the server default light',
      `${control('nullable', 'nullable initial device type', 'button')}.textContent.includes('Default light')`,
    );
    await pick('Sensor reading type', 'Number');
    await typeControl('reading', 'Initial reading', '');
    await check(
      'Clearing a sensor number preserves an invalid draft',
      `${control('reading', 'Initial reading')}.value==='' && ${control('reading', 'Initial reading')}.getAttribute('aria-invalid')==='true'`,
    );
    await click(button('Retry save'));
    assert('Incomplete sensor number never writes', writes === 0);
    await typeControl('reading', 'Initial reading', '-12.5');
    await pick('Sensor reading type', 'Text');
    await typeControl('reading', 'Initial text', 'Window open');
    await pick('Sensor reading type', 'Number');
    await check(
      'Sensor type switch restores its numeric draft',
      `${control('reading', 'Initial reading')}.value==='-12.5'`,
    );
    await goto('/config/integrations');
    await goto(path);
    await until(
      `!!${control('reading', 'Initial reading')}`,
      'Restored sensor draft',
    );
    await check(
      'Navigation retains edited sensor value without saving',
      `${control('reading', 'Initial reading')}.value==='-12.5'`,
    );
    assert('Navigation sends no configuration writes', writes === 0);
    await pick('Sensor reading type', 'Text');
    await check(
      'Text draft is retained independently',
      `${control('reading', 'Initial text')}.value==='Window open'`,
    );
    await pick('Sensor reading type', 'Light state / color');
    await pick('Initial power', 'On');
    await typeControl('reading', 'Initial brightness (%)', '35');
    await click(control('reading', 'Sensor reading type', 'button'));
    await shot('sensor-types');
    await key('Escape', 27);
    await pick('Sensor reading type', 'On / off');
    await pick('Initial reading', 'On / true');
    await pick('Initial reading', 'Off / false');
    await pick('Color temperature support', 'Not supported', 'light');
    await pick('Color temperature support', 'Supported range', 'light');
    await check(
      'Color-temperature mode restores the configured range',
      `${control('light', 'Minimum kelvin')}.value==='2300' && ${control('light', 'Maximum kelvin')}.value==='6100'`,
    );
    await typeControl('light', 'Minimum kelvin', '');
    await check(
      'Clearing Kelvin does not turn into zero',
      `${control('light', 'Minimum kelvin')}.value==='' && ${control('light', 'Minimum kelvin')}.getAttribute('aria-invalid')==='true'`,
    );
    await typeControl('light', 'Minimum kelvin', '2400');
    await typeControl('light', 'Maximum kelvin', '6200');
    await save();
    let saved = await read();
    assert(
      'False, null, unknown sensor fields and edited Kelvin persist',
      saved.config.devices.reading.init_state.Sensor.value === false &&
        JSON.stringify(
          saved.config.devices.reading.init_state.Sensor.future,
        ) === '[0,null]' &&
        saved.config.devices.nullable.init_state === null &&
        saved.config.devices.light.init_state.Controllable.capabilities.ct
          .start === 2400 &&
        saved.config.devices.light.init_state.Controllable.capabilities.ct
          .end === 6200,
    );
    await reload();
    await pick('Sensor reading type', 'Number');
    await typeControl('reading', 'Initial reading', '0');
    await save();
    assert(
      'Zero sensor reading persists',
      (await read()).config.devices.reading.init_state.Sensor.value === 0,
    );
    await pick('Sensor reading type', 'Text');
    await typeControl('reading', 'Initial text', '');
    await save();
    assert(
      'Empty text reading persists',
      (await read()).config.devices.reading.init_state.Sensor.value === '',
    );
    await pick('Sensor reading type', 'Light state / color');
    await pick('Initial power', 'On');
    await typeControl('reading', 'Initial brightness (%)', '35');
    await save();
    assert(
      'Color sensor state persists',
      (await read()).config.devices.reading.init_state.Sensor.power === true &&
        (await read()).config.devices.reading.init_state.Sensor.brightness ===
          0.35,
    );
    await pick('reading initial device type', 'Configured light or control');
    await pick('reading initial device type', 'Sensor');
    await check(
      'Whole device type retains the sensor definition',
      `${control('reading', 'Initial brightness (%)')}.value==='35'`,
    );
    await pick('Sensor reading type', 'Number');
    await typeControl('reading', 'Initial reading', '42');
    await click(button('Discard'));
    await check(
      'Discard restores the saved color reading',
      `${control('reading', 'Initial brightness (%)')}.value==='35'`,
    );
    await type('New device ID', 'extra');
    await click(button('Add device'));
    await pick('extra initial device type', 'Sensor', 'extra');
    await pick('Sensor reading type', 'Text', 'extra');
    await typeControl('extra', 'Initial text', 'New value');
    await click(labeled('Remove device extra', 'button'));
    await type('New device ID', 'extra');
    await click(button('Add device'));
    await pick('extra initial device type', 'Sensor', 'extra');
    await pick('Sensor reading type', 'Text', 'extra');
    await check(
      'Removing and re-adding a device clears inactive drafts',
      `${control('extra', 'Initial text')}.value===''`,
    );
    await save();
    await reload();
    assert(
      'Multiple device entries survive reload',
      Object.keys((await read()).config.devices).length === 4,
    );
    await click(control('reading', 'Sensor reading type', 'button'));
    await key('Escape', 27);
    await check(
      'Device controls fit the viewport',
      `![...document.querySelectorAll('[data-dummy-device] input,[data-dummy-device] button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
    );
    await shot('saved');
    for (const id of ['reading', 'light', 'nullable', 'extra'])
      await click(labeled('Remove device ' + id, 'button'));
    await save();
    assert(
      'Empty device collection remains an empty map',
      JSON.stringify((await read()).config.devices) === '{}',
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

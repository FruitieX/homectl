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
  const id = `mqtt-review-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'mqtt',
    enabled: false,
    config: {
      host: 'fixture.invalid',
      port: 1883,
      mode: 'generic',
      topic: 'fixture/{id}',
      topic_set: 'fixture/{id}/set',
      sensor_value_fields: ['/temperature', '/humidity'],
      disabled_device_ids: ['offline', 'unused'],
      managed: { Partial: { prev_change_committed: false, future: 0 } },
      retain_commands: null,
      capabilities_override: {
        brightness: false,
        ct: { start: 2300, end: 6100 },
      },
      password: 'fixture-only-original',
      future: { keep: [false, 0, null] },
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
  const pick = async (label, text) => {
    await click(labeled(label, 'button'));
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
  let writes = 0,
    creates = 0;
  const payloads = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base && request.method === 'POST') creates++;
    if (request.url === base + '/' + id && request.method === 'PUT') {
      writes++;
      payloads.push(JSON.parse(request.postData));
    }
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/mqtt-editor-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  const field = (key) =>
    `document.querySelector('[data-field="config.${key}"]')`;
  const fieldButton = (key, text) =>
    `[...${field(key)}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
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
    await until(`!!${labeled('Mode', 'button')}`, 'Reloaded');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${labeled('Sensor value fields 1', 'input')}`,
      'MQTT collection fields',
    );
    await check(
      'Null boolean is shown explicitly',
      `${labeled('Retain generic commands', 'button')}.textContent.includes('None (stored)')`,
    );
    await pick('Management mode', 'Full');
    await pick('Management mode', 'Partial management');
    await check(
      'Management mode retains the partial-management flag',
      `!${field('managed')}.querySelector('input[type=checkbox]').checked`,
    );
    await type('Sensor value fields 1', '/climate/temperature');
    await click(fieldButton('sensor_value_fields', 'Add entry'));
    await type('Sensor value fields 3', '/battery');
    await click(labeled('Move earlier Sensor value fields 3', 'button'));
    await click(labeled('Remove Sensor value fields 3', 'button'));
    await click(fieldButton('sensor_value_fields', 'Add entry'));
    await type('Sensor value fields 3', '/humidity');
    await click(fieldButton('disabled_device_ids', 'Add entry'));
    await click(button('Save changes'));
    assert('Blank disabled device blocks saving', writes === 0);
    await type('Disabled devices 3', 'spare');
    await click(labeled('Move earlier Disabled devices 3', 'button'));
    await click(labeled('Remove Disabled devices 3', 'button'));
    await type('Sensor value fields 3', '/invalid~');
    await click(button('Save changes'));
    assert('Every sensor pointer is validated before writing', writes === 0);
    await type('Sensor value fields 3', '/humidity');
    await pick('Mode', 'Zigbee2MQTT');
    await type('Base topic', 'fixture-zigbee');
    await goto('/config/integrations');
    await goto(path);
    await until(
      `!!${labeled('Base topic', 'input')}`,
      'Profile draft restored',
    );
    await check(
      'Profile switch and navigation retain all collection entries',
      `${labeled('Base topic', 'input')}.value==='fixture-zigbee' && ${labeled('Sensor value fields 2', 'input')}.value==='/battery' && ${labeled('Disabled devices 2', 'input')}.value==='spare'`,
    );
    assert(
      'Profile changes and navigation have no implicit write',
      writes === 0,
    );
    await pick('Mode', 'Generic MQTT');
    await pick('Retain generic commands', 'Off');
    await click(labeled('Management mode', 'button'));
    await shot('management');
    await key('Escape', 27);
    await save();
    let saved = await read();
    assert(
      'Edited ordered lists, partial settings and false persist',
      JSON.stringify(saved.config.sensor_value_fields) ===
        '["/climate/temperature","/battery","/humidity"]' &&
        JSON.stringify(saved.config.disabled_device_ids) ===
          '["offline","spare"]' &&
        saved.config.managed.Partial.prev_change_committed === false &&
        saved.config.managed.Partial.future === 0 &&
        saved.config.retain_commands === false,
    );
    assert(
      'Unrelated values and stored secret are preserved',
      saved.config.zigbee2mqtt_base_topic === 'fixture-zigbee' &&
        JSON.stringify(saved.config.future) === '{"keep":[false,0,null]}' &&
        saved.secret_fields.includes('password') &&
        !Object.hasOwn(payloads[0].config, 'password'),
    );
    await reload();
    await type('Minimum kelvin', '');
    await check(
      'Unfinished capability range is visibly invalid',
      `${labeled('Minimum kelvin', 'input')}.getAttribute('aria-invalid')==='true'`,
    );
    await click(fieldButton('capabilities_override', 'Use default'));
    await check(
      'Reset clears the hidden numeric error',
      `!document.querySelector('input[aria-invalid=true]') && !!${button('Save changes')} && !${button('Retry save')}`,
    );
    await save();
    assert(
      'Use default omits the entire capability override',
      !Object.hasOwn((await read()).config, 'capabilities_override'),
    );
    await type('Password', 'fixture-only-replacement');
    await save();
    assert(
      'Explicit password replacement is sent once',
      payloads.at(-1).config.password === 'fixture-only-replacement' &&
        (await read()).secret_fields.includes('password'),
    );
    await click(button('Clear stored password'));
    await until(
      `!!document.querySelector('[role=alertdialog]')`,
      'Clear confirmation',
    );
    await click(button('Clear password'));
    assert(
      'Clearing a secret is staged, not immediate',
      (await read()).secret_fields.includes('password'),
    );
    await save();
    assert(
      'Confirmed clear removes the stored secret after Save',
      !(await read()).secret_fields.includes('password') &&
        payloads.at(-1).config.password === '',
    );
    await click(fieldButton('retain_commands', 'Use default'));
    await save();
    assert(
      'Boolean default remains omitted rather than false',
      !Object.hasOwn((await read()).config, 'retain_commands'),
    );
    await type('Sensor value fields 1', '/discard-me');
    await click(button('Discard'));
    await check(
      'Discard restores the saved lists',
      `${labeled('Sensor value fields 1', 'input')}.value==='/climate/temperature'`,
    );
    await click(labeled('Sensor value fields 1', 'input'));
    await shot('collections');
    await check(
      'Collection controls fit the viewport',
      `![...document.querySelectorAll('[data-field="config.sensor_value_fields"] input,[data-field="config.sensor_value_fields"] button,[data-field="config.disabled_device_ids"] button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
    );
    for (let i = 0; i < 3; i++)
      await click(labeled('Remove Sensor value fields 1', 'button'));
    for (let i = 0; i < 2; i++)
      await click(labeled('Remove Disabled devices 1', 'button'));
    await save();
    await reload();
    saved = await read();
    assert(
      'Empty lists survive reload as explicit arrays',
      JSON.stringify(saved.config.sensor_value_fields) === '[]' &&
        JSON.stringify(saved.config.disabled_device_ids) === '[]',
    );
    await goto('/config/integrations/new');
    await until(
      `!!${labeled('Connection type', 'button')}`,
      'New connection editor',
    );
    await type('Host', 'draft.fixture.invalid');
    await pick('Connection type', 'Dummy');
    await type('New device ID', 'creation-draft');
    await click(button('Add device'));
    await pick('Connection type', 'MQTT');
    await check(
      'Connection-type change retains the MQTT creation draft',
      `${labeled('Host', 'input')}.value==='draft.fixture.invalid'`,
    );
    await pick('Connection type', 'Dummy');
    await check(
      'Connection-type change retains the dummy creation draft',
      `!!document.querySelector('[data-dummy-device="creation-draft"]')`,
    );
    await click(button('Discard'));
    assert('New connection preview and Discard issue no create', creates === 0);
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

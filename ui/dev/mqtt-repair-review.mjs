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
  const id = `mqtt-repair-${width}-${Date.now()}`;
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
      sensor_value_fields: { invalid: false },
      brightness_range: { min: 0, max: 255, future: false },
      transition_range: [0, 600, 42],
      disabled_device_ids: [false, null],
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
      `/tmp/mqtt-repair-${width}-${state}.png`,
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
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  const repair = async (label, confirm = true) => {
    await click(labeled('Replace ' + label, 'button'));
    await until(
      "!!document.querySelector('[role=alertdialog]')",
      'Replacement review',
    );
    await click(
      `[...document.querySelectorAll('[role=alertdialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(confirm ? 'Replace range' : 'Cancel')})`,
    );
    await until(
      "!document.querySelector('[role=alertdialog]')",
      'Replacement review closed',
    );
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await until(
      `!!${labeled('Brightness range stored value')}`,
      'Malformed ranges rendered',
    );
    await check(
      'Malformed range payloads remain visible without coercion',
      `${labeled('Brightness range stored value')}.textContent.includes('"future": false') && ${labeled('Transition range stored value')}.textContent.includes('42')`,
    );
    await check(
      'Malformed lists expose their saved value types',
      `${labeled('Sensor value fields value type', 'button')}.textContent.includes('Fields') && ${labeled('Disabled devices value type', 'button')}.textContent.includes('List')`,
    );
    await evaluate(
      field('brightness_range') + ".scrollIntoView({block:'center'})",
    );
    await shot('repair');
    await repair('Brightness range', false);
    assert(
      'Cancel leaves saved data and draft untouched',
      writes === 0 &&
        JSON.stringify((await read()).config.brightness_range) ===
          JSON.stringify(initial.config.brightness_range),
    );
    await repair('Brightness range');
    await check(
      'Replacement starts from the runtime defaults',
      `${labeled('Brightness range minimum', 'input')}.value==='0' && ${labeled('Brightness range maximum', 'input')}.value==='1'`,
    );
    await type('Brightness range maximum', '255');
    await click(button('Discard'));
    await until(
      `!!${labeled('Brightness range stored value')}`,
      'Discard restores repair value',
    );
    assert(
      'Discard and range repair issue no configuration writes',
      writes === 0,
    );
    await repair('Brightness range');
    await repair('Transition range');
    await pick('Sensor value fields value type', 'List');
    await click(fieldButton('sensor_value_fields', 'Add entry'));
    await type('Sensor value fields 1', '/temperature');
    await click(fieldButton('disabled_device_ids', 'Use default'));
    await click(fieldButton('disabled_device_ids', 'Add entry'));
    await type('Disabled devices 1', 'retired');
    await type('Brightness range maximum', '255');
    await type('Transition range maximum', '1000');
    await type('Brightness range minimum', '-');
    await click(button('Retry save'));
    assert('Unfinished endpoint cannot save', writes === 0);
    await check(
      'Validation focuses the unfinished endpoint',
      `document.activeElement===${labeled('Brightness range minimum', 'input')}`,
    );
    await goto('/config/integrations');
    await goto(path);
    await until(
      `!!${labeled('Brightness range minimum', 'input')}`,
      'Retained draft',
    );
    await check(
      'Navigation preserves incomplete endpoints and other repairs',
      `${labeled('Brightness range minimum', 'input')}.value==='-' && ${labeled('Brightness range maximum', 'input')}.value==='255' && ${labeled('Transition range maximum', 'input')}.value==='1000'`,
    );
    await evaluate(
      field('brightness_range') + ".scrollIntoView({block:'center'})",
    );
    await shot('draft');
    await type('Brightness range minimum', '256');
    await click(button('Save changes'));
    assert('Reversed endpoints cannot save', writes === 0);
    await type('Brightness range minimum', '0');
    await type('Transition range minimum', '0');
    await save();
    const saved = await read();
    assert(
      'Explicit repair saves exact ranges and repaired collections',
      JSON.stringify(saved.config.brightness_range) === '[0,255]' &&
        JSON.stringify(saved.config.transition_range) === '[0,1000]' &&
        JSON.stringify(saved.config.sensor_value_fields) ===
          '["/temperature"]' &&
        JSON.stringify(saved.config.disabled_device_ids) === '["retired"]',
    );
    assert(
      'Repair preserves extension values, false, null and stored secrets',
      JSON.stringify(saved.config.future) ===
        JSON.stringify(initial.config.future) &&
        saved.config.retain_commands === null &&
        saved.config.managed.Partial.prev_change_committed === false &&
        saved.secret_fields.includes('password') &&
        !Object.hasOwn(payloads[0].config, 'password'),
    );
    await reload();
    await check(
      'Both repaired ranges survive reload',
      `${labeled('Brightness range maximum', 'input')}.value==='255' && ${labeled('Transition range maximum', 'input')}.value==='1000'`,
    );
    await type('Brightness range maximum', '');
    await click(fieldButton('brightness_range', 'Use default'));
    await type('Transition range maximum', '1e3');
    await save();
    const final = await read();
    assert(
      'Default removes range and unfinished input; exponent saves a number',
      !Object.hasOwn(final.config, 'brightness_range') &&
        final.config.transition_range[1] === 1000,
    );
    await reload();
    await check(
      'Default placeholders match actual runtime endpoints',
      `${labeled('Brightness range minimum', 'input')}.placeholder==='0' && ${labeled('Brightness range maximum', 'input')}.placeholder==='1' && ${labeled('Brightness range maximum', 'input')}.value===''`,
    );
    assert(
      'No page exceptions or unintended creates',
      exceptions.length === 0 && creates === 0,
    );
    await check(
      'No horizontal page overflow',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    return {
      passed: true,
      checks,
      scope:
        'Temporary disabled integration in an isolated marked fixture; no broker or household configuration used',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await goto('/config/integrations');
    await cleanup();
  }
}

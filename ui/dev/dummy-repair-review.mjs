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
  const id = `dummy-repair-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'dummy',
    enabled: false,
    config: { devices: [false, null], future: { keep: [0, false, null] } },
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
      `/tmp/dummy-repair-${width}-${state}.png`,
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
    await until(`document.body.textContent.includes('Devices')`, 'Reloaded');
  };

  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  const choose = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[role=option]')", 'Options visible');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const unchanged = (expected) =>
    JSON.stringify(expected) === JSON.stringify(saved.config.devices);
  let saved;
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${labeled('Devices value type', 'button')}`,
      'Malformed collection visible',
    );
    await check(
      'Malformed device collection is visible without coercion',
      "document.body.textContent.includes('current value is preserved') && document.body.textContent.includes('None (null)')",
    );
    await shot('collection');
    await choose(labeled('Devices value type', 'button'), 'Fields');
    assert('Collection repair is staged', writes === 0);
    await click(button('Discard'));
    await until(`!!${labeled('Devices value type', 'button')}`, 'Discarded');
    await check(
      'Discard restores the original malformed collection',
      `${labeled('Devices value type', 'button')}.textContent.includes('List')`,
    );
    await choose(labeled('Devices value type', 'button'), 'Fields');
    await save();
    await reload();
    saved = await read();
    assert(
      'Explicit collection repair saves an empty map and keeps extensions',
      unchanged({}) &&
        JSON.stringify(saved.config.future) ===
          JSON.stringify(initial.config.future),
    );
    const devices = {
      broken: false,
      future: {
        name: 'Unknown initial type',
        init_state: { Future: { keep: [false, 0, null] } },
      },
      light: {
        name: 'Malformed light color',
        init_state: {
          Controllable: {
            state: { power: false, brightness: 0, color: true, extra: 'keep' },
            capabilities: {},
          },
        },
      },
      reading: {
        name: 'Malformed sensor color',
        init_state: {
          Sensor: {
            power: false,
            color: { ct: 'warm', future: false },
            extra: [0, null],
          },
        },
      },
      valid: {
        name: 'Valid state',
        init_state: { Sensor: { value: false, future: [null, 0] } },
      },
    };
    const updated = await fetch(base + '/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...initial,
        config: { ...initial.config, devices },
      }),
    });
    if (!updated.ok) throw Error('Fixture seed failed');
    await reload();
    await until(`!!${row('reading')}`, 'Malformed entries loaded');
    await check(
      'Malformed entries, unknown variants and colors remain inspectable',
      `!!${control('broken', 'Device definition value type', 'button')} && ${control('future', 'future initial device type', 'button')}.textContent.includes('Unrecognized') && document.body.textContent.includes('Stored color needs repair')`,
    );

    await evaluate(`${row('light')}.scrollIntoView({block:'center'})`);
    await shot('colors');
    await choose(
      control('light', 'Initial color value type', 'button'),
      'Use default',
    );
    await click(button('Discard'));
    await check(
      'Discard restores the malformed color exactly',
      `${control('light', 'Initial color value type', 'button')}.textContent.includes('True / false')`,
    );
    saved = await read();
    assert(
      'Inspecting and discarding sends no writes',
      unchanged(devices) && writes === 1,
    );
    await choose(
      control('light', 'Initial color value type', 'button'),
      'Use default',
    );
    // The other malformed entries still prevent saving this incomplete repair.
    const saveButton = `[...document.querySelectorAll('button')].find(b=>['Save changes','Retry save'].includes(b.textContent.trim()))`;
    await click(saveButton);
    assert('Incomplete repairs are not written', writes === 1);
    await click(labeled('Remove device broken', 'button'));
    await choose(
      control('future', 'future initial device type', 'button'),
      'Default light',
    );
    await choose(
      control('reading', 'Initial color value type', 'button'),
      'Use default',
    );
    await click(saveButton);
    await until(`!${button('Discard')}`, 'Repaired Save acknowledged');
    await reload();
    saved = await read();
    const expected = structuredClone(devices);
    delete expected.broken;
    delete expected.future.init_state;
    delete expected.light.init_state.Controllable.state.color;
    delete expected.reading.init_state.Sensor.color;
    assert(
      'Explicit repairs survive Save/reload without changing siblings',
      unchanged(expected) && writes === 2,
    );
    await until(`!!${row('light')}`, 'Repaired devices rendered');
    await evaluate(`${row('light')}.scrollIntoView({block:'center'})`);
    await shot('repaired');
    await check(
      'Repair controls fit the viewport',
      'document.documentElement.scrollWidth<=innerWidth',
    );
    assert('No page exceptions', exceptions.length === 0);
    return {
      passed: true,
      checks,
      scope: 'Owned disabled fixture integration; no integration execution',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

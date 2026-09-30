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
  const id = `esphome-review-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'mqtt',
    enabled: false,
    config: {
      host: 'fixture.invalid',
      port: 1883,
      mode: 'esphome',
      topic: 'fixture/{id}',
      topic_set: 'fixture/{id}/set',
      future: { keep: [0, false, null] },
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
      `/tmp/esphome-editor-${width}-${state}.png`,
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
  const edit = async (key, text) => {
    await click(`${field(key)}.querySelector('input')`);
    await keypressAll(text);
  };
  const keypressAll = async (text) => {
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const saveControl = `[...document.querySelectorAll('button')].find(b=>['Save changes','Retry save'].includes(b.textContent.trim()))`;
  const commit = async () => {
    await click(saveControl);
    await until(`!${button('Discard')}`, 'Save acknowledged');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('Warm white', 'input')}`, 'ESPHome fields');
    await check(
      'Unset endpoints show server defaults without writing them',
      `${labeled('Warm white', 'input')}.value==='' && ${labeled('Warm white', 'input')}.placeholder==='2700' && ${labeled('Cold white', 'input')}.placeholder==='6500'`,
    );
    await edit('esphome_warm_white_kelvin', '7000');
    await click(saveControl);
    await check(
      'Inverted endpoints explain the repair',
      "document.body.textContent.includes('Warm white must be lower')",
    );
    assert('Invalid endpoints never write', writes === 0);
    const edited = {
      esphome_base_topic: 'fixture/esp',
      esphome_light_object_id: 'ceiling',
      esphome_discovery_prefix: 'fixture/discovery',
      esphome_warm_white_kelvin: 2200,
      esphome_cold_white_kelvin: 7200,
    };
    for (const [key, value] of Object.entries(edited))
      await edit(key, String(value));
    await pick('Mode', 'Zigbee2MQTT');
    await edit('zigbee2mqtt_base_topic', 'fixture/zigbee');
    await pick('Mode', 'Generic MQTT');
    await goto('/config/integrations');
    await goto(path);
    await until(`!!${labeled('Mode', 'button')}`, 'Retained draft');
    await pick('Mode', 'ESPHome');
    for (const [key, value] of Object.entries(edited))
      await check(
        'Retained ' + key,
        `${field(key)}.querySelector('input').value===${JSON.stringify(String(value))}`,
      );
    assert('Profile changes and navigation stage edits only', writes === 0);
    await evaluate(
      `${field('esphome_base_topic')}.closest('section').scrollIntoView({block:'start'})`,
    );
    await shot('fields');
    await commit();
    await reload();
    let saved = await read();
    assert(
      'All edited ESPHome fields and inactive profiles persist',
      Object.entries(edited).every(
        ([key, value]) => saved.config[key] === value,
      ) &&
        saved.config.zigbee2mqtt_base_topic === 'fixture/zigbee' &&
        saved.config.topic === initial.config.topic &&
        saved.config.topic_set === initial.config.topic_set &&
        JSON.stringify(saved.config.future) ===
          JSON.stringify(initial.config.future),
    );
    await edit('esphome_warm_white_kelvin', '2600');
    await click(button('Discard'));
    await check(
      'Discard restores the saved endpoint',
      `${labeled('Warm white', 'input')}.value==='2200'`,
    );
    for (const key of Object.keys(edited))
      await click(fieldButton(key, 'Use default'));
    await commit();
    await reload();
    saved = await read();
    assert(
      'Default reset omits all five overrides after reload',
      Object.keys(edited).every((key) => !Object.hasOwn(saved.config, key)) &&
        writes === 2,
    );
    await check(
      'Fields fit the viewport',
      'document.documentElement.scrollWidth<=innerWidth',
    );
    assert('No page exceptions', exceptions.length === 0);
    return {
      passed: true,
      checks,
      scope: 'Owned disabled fixture integration; no broker connection',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

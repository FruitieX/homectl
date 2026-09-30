import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/groups';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const id = 'group-collection-review-' + width;
  const original = (await marker.json()).data;
  if (original.some((g) => g.id === id))
    throw Error('Review ID already exists');
  const seed = {
    id,
    name: 'Collection review',
    hidden: false,
    devices: [
      {
        integration_id: 'missing-integration',
        device_id: 'unavailable-device',
      },
    ],
    linked_groups: ['unavailable-group'],
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
    (await (await fetch(base)).json()).data.find((g) => g.id === id);
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
  const button = (s) =>
    "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===" +
    JSON.stringify(s) +
    ')';
  const field = "document.querySelector('[data-field=name]')";
  const checks = [];
  let writes = 0;
  const payloads = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method === 'PUT' && request.url === base + '/' + id) {
      writes++;
      payloads.push(JSON.parse(request.postData));
    }
  });
  const check = async (name, condition) => {
    if (!condition) throw Error(name);
    checks.push({ name, passed: true });
  };
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
      '/tmp/group-collections-' + width + '-' + name + '.png',
      Buffer.from(data, 'base64'),
    );
  };
  const reload = async () => {
    let resolve;
    const ready = new Promise((r) => (resolve = r));
    cdp.on('Page.loadEventFired', () => resolve());
    await cdp.send('Page.reload');
    await ready;
    await until('!!' + field, 'Editor reloaded');
  };
  const select = async (kind, ids) => {
    await activate(button('Add ' + kind));
    await until(
      "!!document.querySelector('[role=dialog] input[type=checkbox]')",
      'Picker loaded',
    );
    const selector =
      "[...document.querySelectorAll('[role=dialog] input[type=checkbox]')]";
    const rows = await evaluate(
      selector +
        ".map(e=>({key:e.closest('label').querySelector('span span:last-child').textContent,checked:e.checked}))",
    );
    for (let i = 0; i < rows.length; i++)
      if (rows[i].checked !== ids.includes(rows[i].key)) {
        await evaluate(selector + '[' + i + '].focus()');
        await key(' ', 32);
      }
    await activate(button('Done'));
    await until("!document.querySelector('[role=dialog]')", 'Done closes');
  };
  const save = async (expected, name) => {
    const before = writes;
    await activate(button('Save changes'));
    await until('!' + button('Save changes'), 'Save finished');
    const row = await saved();
    await check(
      name + ' persists exact membership',
      JSON.stringify(row.devices) === JSON.stringify(expected.devices) &&
        JSON.stringify(row.linked_groups) ===
          JSON.stringify(expected.linked_groups),
    );
    await check(
      name + ' writes once with expected state',
      writes === before + 1 &&
        !!payloads.at(-1).expected &&
        !('device_keys' in payloads.at(-1)),
    );
    await reload();
    await check(
      name + ' reload renders exact counts',
      await evaluate(
        "document.querySelectorAll('#devices li[data-target-key]').length===" +
          expected.devices.length +
          "&&document.querySelectorAll('#links li[data-target-key]').length===" +
          expected.linked_groups.length,
      ),
    );
  };
  await request('POST', seed);
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', { url: origin + '/config/groups/' + id });
    await until('!!' + field, 'Editor loaded');
    await check(
      'Missing device and group remain visible',
      await evaluate(
        "document.querySelector('#devices').textContent.includes('Missing')&&document.querySelector('#links').textContent.includes('Missing group')",
      ),
    );
    await check(
      'Missing member section and repair actions fit the page',
      await evaluate(
        "[...document.querySelectorAll('.settings-section')].every(e=>e.scrollWidth<=e.clientWidth+1)&&[...document.querySelectorAll('#devices button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})",
      ),
    );
    await shot('missing');
    await type(field, 'Missing references retained');
    await save(seed, 'Unrelated name edit');
    await activate(button('Replace'));
    await type(
      'document.querySelector(\'input[aria-label="Search devices by name, id, or integration"]\')',
      'kitchen_counter',
    );
    await activate(button('Add'));
    await save(
      {
        ...seed,
        devices: [{ integration_id: 'esphome', device_id: 'kitchen_counter' }],
      },
      'Missing device replacement',
    );
    const beforeEmpty = writes;
    await select('devices', []);
    await select('groups', []);
    await check(
      'Empty selections are staged before Save',
      writes === beforeEmpty && (await saved()).devices.length === 1,
    );
    await save({ devices: [], linked_groups: [] }, 'Empty arrays');
    await check(
      'Empty collections have useful states',
      await evaluate(
        "document.body.textContent.includes('No direct devices yet.')&&document.body.textContent.includes('No linked groups yet.')",
      ),
    );
    const d1 = { integration_id: 'esphome', device_id: 'kitchen_counter' },
      d2 = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' };
    const k = (d) => d.integration_id + '/' + d.device_id;
    await select('devices', [k(d1)]);
    await select('groups', ['kitchen']);
    await save(
      { devices: [d1], linked_groups: ['kitchen'] },
      'Single selections',
    );
    await select('devices', [k(d1), k(d2)]);
    await select('groups', ['kitchen', 'bedroom']);
    await save(
      { devices: [d1, d2], linked_groups: ['kitchen', 'bedroom'] },
      'Multiple selections',
    );
    await shot('multiple');
    await check(
      'Multiple member sections fit the page',
      await evaluate(
        "[...document.querySelectorAll('.settings-section')].every(e=>e.scrollWidth<=e.clientWidth+1)",
      ),
    );
    await type(field, 'Retained after deletion');
    await request('DELETE');
    await activate(button('Save changes'));
    await until(
      "document.body.textContent.includes('This item was deleted.')",
      'Deleted error visible',
    );
    await check('Deleted group is not recreated', !(await saved()));
    await check(
      'Deletion error retains edited name',
      await evaluate(field + ".value==='Retained after deletion'"),
    );
    await shot('deleted');
    await activate(button('Discard'));
    await check(
      'Discard clears the unsaved deletion draft',
      await evaluate('!' + button('Save changes')),
    );
    await check(
      'No page overflow',
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    );
    await cdp.send('Page.navigate', { url: origin + '/config/groups/new' });
    await until("!!document.querySelector('[data-field=id]')", 'Create editor');
    await type(field, 'New room retained through conflict');
    await type("document.querySelector('[data-field=id]')", id);
    // A second client creates this ID after the editor loaded its catalog.
    await request('POST', seed);
    await activate(button('Create room or group'));
    await until(
      "document.body.textContent.includes('This ID is already in use.')",
      'Creation conflict',
    );
    await check(
      'Creation race preserves the existing group',
      (await saved()).name === seed.name,
    );
    await check(
      'Creation race retains the new draft',
      await evaluate(field + ".value==='New room retained through conflict'"),
    );
    await shot('create-conflict');
    await type("document.querySelector('[data-field=id]')", id + '-retry');
    await activate(button('Create room or group'));
    await until(
      'location.pathname===' +
        JSON.stringify('/config/groups/' + id + '-retry'),
      'Retried creation opens saved group',
    );
    const created = (await (await fetch(base)).json()).data.find(
      (g) => g.id === id + '-retry',
    );
    await check(
      'Changing the conflicted ID creates the retained draft',
      created?.name === 'New room retained through conflict' &&
        created.devices.length === 0 &&
        created.linked_groups.length === 0,
    );
    return {
      passed: true,
      checks,
      scope:
        'Temporary local fixture record; exact serialized payloads and page reload, not database durability',
    };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await request('DELETE');
    await fetch(base + '/' + id + '-retry', { method: 'DELETE' });
  }
}

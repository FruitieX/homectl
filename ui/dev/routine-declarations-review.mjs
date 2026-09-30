import { writeFile } from 'node:fs/promises';
// All writes are confined to an owned routine in the marked local fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/routines';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = 'routine-declarations-' + width + '-' + Date.now(),
    path = '/config/routines/' + id;
  const initial = {
    id,
    name: 'Evening lights',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [{ id: 'manual', kind: 'manual' }],
      condition: { kind: 'literal', value: true },
      program: {
        kind: 'native',
        steps: [
          {
            id: 'script',
            action: 'run_script',
            spec: {
              api_version: 1,
              limits_profile: 'default',
              source_body: 'return { actions: [] };',
              future: 'spec-kept',
              declarations: [
                {
                  kind: 'device',
                  device: {
                    integration_id: 'zigbee2mqtt',
                    device_id: 'living_room_lamp',
                    future: 'ref-kept',
                  },
                  future: 'device-kept',
                },
                {
                  kind: 'group',
                  group_id: 'living_room',
                  future: 'group-kept',
                },
                { kind: 'timer', timer: 'off', future: 'timer-kept' },
                { kind: 'all_state', future: 'all-kept' },
                { kind: 'future', payload: { preserve: true } },
              ],
            },
          },
          {
            id: 'minimal',
            action: 'run_script',
            spec: {
              api_version: 1,
              source_body: 'return { actions: [] };',
              future: 'minimal-kept',
            },
          },
          {
            id: 'unsupported',
            action: 'run_script',
            spec: {
              api_version: 99,
              limits_profile: 'future',
              source_body: 'future();',
              declarations: [],
            },
          },
        ],
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
  const labeled = (label, tag = '', scope = 'document') =>
    `${scope}?.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)})`;
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
  const type = async (label, value, scope = 'document') => {
    await click(labeled(label, 'input', scope));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (label, text, scope = 'document') => {
    await click(labeled(label, 'button', scope));
    await until(
      `!!document.querySelector('[data-radix-select-viewport] [role=option]')`,
      'Type options',
    );
    const index = await evaluate(
      `[...document.querySelectorAll('[data-radix-select-viewport] [role=option]')].findIndex(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
    if (index < 0) throw Error('Missing option ' + text);
    await key('Home', 36);
    await pause();
    for (let i = 0; i < index; i++) {
      await key('ArrowDown', 40);
      await pause();
    }
    await key('Enter', 13);
    await until(
      labeled(label, 'button', scope) +
        ".getAttribute('aria-expanded')==='false'",
      'Selection closed',
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
      `/tmp/routine-declarations-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  const assert = (name, condition) => {
    if (!condition) throw Error(name);
    checks.push({ name, passed: true });
  };
  const save = async () => {
    await click(
      '(' + button('Save changes') + ' || ' + button('Retry save') + ')',
    );
    await until(`!${button('Discard')}`, 'Source saved');
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(`!!${labeled('Trigger type', 'button')}`, 'Source reloaded');
  };

  const node = (id) =>
    'document.querySelector(' +
    JSON.stringify('[data-node-id="' + id + '"]') +
    ')';

  const script = node('script'),
    minimal = node('minimal');
  const row = (index, scope = script) =>
    scope + '.querySelector(\'[data-declaration-index="' + index + '"]\')';
  const input = (label, scope = 'document') => labeled(label, 'input', scope);
  const localButton = (text, scope) =>
    `[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const cmd = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[cmdk-item]')", 'Picker');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
        JSON.stringify(text) +
        '))',
    );
  };
  const spec = async (id = 'script') =>
    (await read()).definition_v2.program.steps.find((s) => s.id === id).spec;
  const plain = async (scope, body) => {
    if (!(await evaluate('!!' + labeled('Script body', 'textarea', scope))))
      await click(localButton('Plain text', scope));
    await click(labeled('Script body', 'textarea', scope));
    await key('a', 65, 2);
    await key('Backspace', 8);
    await cdp.send('Input.insertText', { text: body });
    await pause();
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      '!!' + labeled('Declaration type', 'button', script),
      'Script ready',
    );
    await check(
      'Malformed future declaration remains visible for explicit removal',
      row(4) +
        ".textContent.includes('Unrecognized declaration') && " +
        row(4) +
        ".textContent.includes('preserve')",
    );
    await check(
      'Unsupported script API is preserved without editable body',
      node('unsupported') +
        ".textContent.includes('future();') && !" +
        node('unsupported') +
        ".querySelector('textarea')",
    );
    assert('Viewing unsupported content writes nothing', writes === 0);
    await click(labeled('Remove declaration', 'button', row(4)));
    await click(
      labeled('Actions for unsupported', 'button', node('unsupported')),
    );
    await click(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='Remove')",
    );
    await check(
      'Omitted declaration and limits defaults render as an editable script',
      minimal +
        ".textContent.includes('No declarations.') && " +
        minimal +
        ".textContent.includes('default limits')",
    );
    await cmd(labeled('Select device...', 'button', row(0)), 'Floor lamp');
    await cmd(labeled('Select group...', 'button', row(1)), 'Kitchen');
    await type('Declaration timer name', 'lights_off', row(2));
    await pick('Declaration type', 'Room or group', row(0));
    await cmd(labeled('Select group...', 'button', row(0)), 'Bedroom');
    await pick('Declaration type', 'Device', row(0));
    await check(
      'Changing declaration type restores the selected device',
      row(0) + ".textContent.includes('Floor lamp')",
    );
    await pick('Declaration type', 'Room or group', row(0));
    await check(
      'Returning to group restores its independent choice',
      row(0) + ".textContent.includes('Bedroom')",
    );
    await pick('Declaration type', 'Device', row(0));
    await save();
    let value = await spec();
    assert(
      'Edited device declaration retains row and reference extensions',
      value.declarations[0].device.device_id === 'living_room_floor_lamp' &&
        value.declarations[0].future === 'device-kept' &&
        value.declarations[0].device.future === 'ref-kept',
    );
    assert(
      'Group, timer, all-state and script extensions survive Save',
      value.declarations[1].group_id === 'kitchen' &&
        value.declarations[1].future === 'group-kept' &&
        value.declarations[2].timer === 'lights_off' &&
        value.declarations[2].future === 'timer-kept' &&
        value.declarations[3].future === 'all-kept' &&
        value.future === 'spec-kept',
    );
    assert(
      'Omitted defaults remain omitted when another block is edited',
      !('declarations' in (await spec('minimal'))) &&
        !('limits_profile' in (await spec('minimal'))),
    );
    await click(localButton('Enter an ID', row(0)));
    await type('Declaration integration ID', 'future_bridge', row(0));
    await type('Declaration device ID', 'lights/new_lamp', row(0));
    await click(localButton('Enter an ID', row(1)));
    await type('Declaration group ID', 'future_room', row(1));
    await save();
    value = await spec();
    assert(
      'Forward device and group declarations save exact IDs',
      value.declarations[0].device.integration_id === 'future_bridge' &&
        value.declarations[0].device.device_id === 'lights/new_lamp' &&
        value.declarations[1].group_id === 'future_room',
    );
    await shot('references');
    await goto('/config/routines');
    await goto(path);
    await until(
      '!!' + input('Declaration device ID', row(0)),
      'Declaration draft ready',
    );
    await check(
      'Forward IDs remain visible after navigation',
      input('Declaration device ID', row(0)) + ".value==='lights/new_lamp'",
    );
    await type('Declaration timer name', 'temporary', row(2));
    await click(button('Discard'));
    await check(
      'Discard restores declared timer',
      input('Declaration timer name', row(2)) + ".value==='lights_off'",
    );
    await pick('Declaration type', 'Device', row(1));
    await cmd(labeled('Select device...', 'button', row(1)), 'Floor lamp');
    await pick('Declaration type', 'Room or group', row(1));
    await click(labeled('Remove declaration', 'button', row(0)));
    await pick('Declaration type', 'Device', row(0));
    await check(
      'Type drafts follow a declaration after removing an earlier row',
      row(0) + ".textContent.includes('Floor lamp')",
    );
    await pick('Declaration type', 'Room or group', row(0));
    await save();
    assert(
      'Removal preserves order and restored reference',
      (await spec()).declarations.map((d) => d.kind).join(',') ===
        'group,timer,all_state' &&
        (await spec()).declarations[0].group_id === 'future_room',
    );
    for (let i = 0; i < 3; i++)
      await click(labeled('Remove declaration', 'button', row(0)));
    await save();
    assert(
      'Explicit empty declarations save as an empty list',
      (await spec()).declarations.length === 0,
    );
    for (const [label, kind] of [
      ['Device', 'device'],
      ['Room or group', 'group'],
      ['Named timer', 'timer'],
      ['All device state', 'all_state'],
    ]) {
      await pick('New declaration type', label, script);
      await click(localButton('Add declaration', script));
      const index = { device: 0, group: 1, timer: 2, all_state: 3 }[kind];
      if (kind === 'device')
        await cmd(
          labeled('Select device...', 'button', row(index)),
          'Floor lamp',
        );
      if (kind === 'group')
        await cmd(labeled('Select group...', 'button', row(index)), 'Kitchen');
      if (kind === 'timer')
        await type('Declaration timer name', 'review_timer', row(index));
    }
    await plain(script, 'return { actions: [], next_state: {count: 1} };');
    await save();
    value = await spec();
    assert(
      'All four declaration kinds can be recreated and saved',
      value.declarations.map((d) => d.kind).join(',') ===
        'device,group,timer,all_state',
    );
    assert(
      'Script body edits retain declarations and metadata',
      value.source_body.includes('count: 1') &&
        value.api_version === 1 &&
        value.limits_profile === 'default',
    );
    await pick('New declaration type', 'Named timer', minimal);
    await click(localButton('Add declaration', minimal));
    await type('Declaration timer name', 'independent', row(0, minimal));
    await save();
    assert(
      'Separate script blocks keep independent declarations',
      (await spec('minimal')).declarations[0].timer === 'independent' &&
        (await spec()).declarations[2].timer === 'review_timer',
    );
    await shot('declarations');
    await reload();
    assert(
      'Script declarations survive reload',
      (await spec()).declarations.length === 4 &&
        (await spec('minimal')).declarations.length === 1,
    );
    await check(
      'Declaration controls fit the viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

import { writeFile } from 'node:fs/promises';
// Own records only, on the marked local fixture; no household writes.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/routines',
    helperBase = origin + '/api/v1/config/helpers';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = 'routine-actions-' + width + '-' + Date.now(),
    path = '/config/routines/' + id;
  const main = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' };
  const helperRows = [
    {
      id: id + '-number',
      name: 'Review number',
      kind: { kind: 'number', min: 2, max: 8 },
      initial_value: 2,
    },
    {
      id: id + '-bool',
      name: 'Review flag',
      kind: { kind: 'boolean' },
      initial_value: true,
    },
    {
      id: id + '-enum',
      name: 'Review choice',
      kind: { kind: 'enum', options: ['on', 'off'] },
      initial_value: 'on',
    },
    {
      id: id + '-string',
      name: 'Review text',
      kind: { kind: 'string' },
      initial_value: 'text',
    },
  ];
  for (const row of helperRows) {
    const r = await fetch(helperBase + '/' + row.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...row, persistence: 'durable' }),
    });
    if (!r.ok) throw Error('Helper fixture create failed');
  }
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
          { id: 'power', action: 'set_power', device: main, power: true },
          {
            id: 'dim',
            action: 'dim',
            step: -0.1,
            targets: { devices: [main], groups: [] },
            transition_ms: 2000,
            future: 'kept',
          },
          {
            id: 'random',
            action: 'randomize_color',
            targets: { devices: [main] },
            min_saturation: 0.2,
            max_saturation: 1,
            transition_ms: 2000,
          },
          {
            id: 'schedule',
            action: 'schedule_timer',
            timer: 'off',
            delay_ms: 60000,
          },
          {
            id: 'replace',
            action: 'replace_timer',
            timer: 'off',
            delay_ms: 60000,
          },
          { id: 'cancel', action: 'cancel_timer', timer: 'off' },
          {
            id: 'helper',
            action: 'set_helper',
            helper: helperRows[0].id,
            value: 3,
          },
          {
            id: 'invoke',
            action: 'invoke_routine',
            routine_id: 'motion_on',
            mode: 'fire_and_forget',
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
    await until(`!!document.querySelector('[role=option]')`, 'Type options');
    const index = await evaluate(
      `[...document.querySelectorAll('[role=option]')].findIndex(e=>e.textContent.trim()===${JSON.stringify(text)})`,
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
      "!document.querySelector('[role=listbox]')",
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
      `/tmp/routine-actions-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
    for (const row of helperRows)
      await fetch(helperBase + '/' + row.id, { method: 'DELETE' });
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

  const input = (label, scope = 'document') => labeled(label, 'input', scope);
  const attempt = async () =>
    click('(' + button('Save changes') + ' || ' + button('Retry save') + ')');
  const steps = async () => (await read()).definition_v2.program.steps;
  const current = async (id) => (await steps()).find((s) => s.id === id);
  const cmd = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[cmdk-item]')", 'Picker ready');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
        JSON.stringify(text) +
        '))',
    );
  };
  const dim = node('dim'),
    random = node('random'),
    helper = node('helper');
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until('!!' + input('Dim step', dim), 'Actions ready');
    await type('Dim step', '-', dim);
    await attempt();
    await check(
      'Incomplete dim change stays editable and receives focus',
      input('Dim step', dim) +
        ".value==='-' && document.activeElement===" +
        input('Dim step', dim),
    );
    assert('Invalid dim change sends no writes', writes === 0);
    await goto('/config/routines');
    await goto(path);
    await until('!!' + input('Dim step', dim), 'Draft ready');
    await check(
      'Dim raw draft survives navigation',
      input('Dim step', dim) + ".value==='-'",
    );
    await click(button('Discard'));
    await check(
      'Discard restores saved dim amount',
      input('Dim step', dim) + ".value==='-0.1'",
    );
    for (const raw of ['0', '1.1']) {
      await type('Dim step', raw, dim);
      await attempt();
      await check(
        'Dim rejects ' + raw,
        input('Dim step', dim) + ".getAttribute('aria-invalid')==='true'",
      );
    }
    await type('Dim step', '-0.25', dim);
    await type('Transition', '0', dim);
    await attempt();
    await check(
      'Zero dim transition is explained',
      input('Transition', dim) + ".getAttribute('aria-invalid')==='true'",
    );
    await type('Transition', '', dim);
    await save();
    let value = await current('dim');
    assert(
      'Negative dim change, optional fade and extensions save',
      value.step === -0.25 &&
        !('transition_ms' in value) &&
        value.future === 'kept',
    );
    await type('Dim step', '0.5', dim);
    await pick('Transition unit', 'seconds', dim);
    await type('Transition', '1.001', dim);
    await save();
    value = await current('dim');
    assert(
      'Positive dim change and millisecond fade save',
      value.step === 0.5 && value.transition_ms === 1001,
    );
    await pick('Power', 'Turn off', node('power'));
    await save();
    assert(
      'Power writes a false boolean to a single device',
      (await current('power')).power === false,
    );
    await cmd(
      labeled('Select device...', 'button', node('power')),
      'Floor lamp',
    );
    for (const scope of [dim, random]) {
      await cmd(labeled('Add devices…', 'button', scope), 'Floor lamp');
      await cmd(labeled('Add groups…', 'button', scope), 'Living room');
    }
    await save();
    assert(
      'Power device selection saves',
      (await current('power')).device.device_id === 'living_room_floor_lamp',
    );
    for (const id of ['dim', 'random']) {
      const value = await current(id);
      assert(
        id + ' saves multiple devices and a room target',
        value.targets.devices.length === 2 &&
          value.targets.groups[0] === 'living_room',
      );
    }
    await type('Min saturation', '-', random);
    await attempt();
    await check(
      'Saturation retains incomplete raw text',
      input('Min saturation', random) +
        ".value==='-' && document.activeElement===" +
        input('Min saturation', random),
    );
    await type('Min saturation', '0', random);
    await type('Max saturation', '', random);
    await type('Transition', '', random);
    await save();
    value = await current('random');
    assert(
      'Zero saturation and omitted upper bound/fade remain distinct',
      value.min_saturation === 0 &&
        !('max_saturation' in value) &&
        !('transition_ms' in value),
    );
    await type('Min saturation', '1.2', random);
    await type('Max saturation', '-0.2', random);
    await pick('Transition unit', 'seconds', random);
    await type('Transition', '1.001', random);
    await save();
    value = await current('random');
    assert(
      'Runtime-normalized saturation bounds remain as authored',
      value.min_saturation === 1.2 &&
        value.max_saturation === -0.2 &&
        value.transition_ms === 1001,
    );
    await shot('colors');
    for (const action of ['schedule', 'replace']) {
      const scope = node(action);
      await type('Delay', '', scope);
      await attempt();
      await check(
        'Required ' + action + ' delay retains empty draft',
        input('Delay', scope) +
          ".value==='' && document.activeElement===" +
          input('Delay', scope),
      );
      await pick('Delay unit', 'hours', scope);
      await type('Delay', '169', scope);
      await attempt();
      await check(
        action + ' delay enforces seven-day bound',
        input('Delay', scope) + ".getAttribute('aria-invalid')==='true'",
      );
      await type('Delay', '0', scope);
      await type('Timer name', 'lights_off', scope);
      await save();
      value = await current(action);
      assert(
        action + ' accepts zero as queued execution',
        value.delay_ms === 0 && value.timer === 'lights_off',
      );
    }
    await pick('Delay unit', 'seconds', node('replace'));
    await type('Delay', '1.001', node('replace'));
    await type('Timer name', 'lights_off', node('cancel'));
    await save();
    assert(
      'Replace and cancel timer fields persist',
      (await current('replace')).delay_ms === 1001 &&
        (await current('cancel')).timer === 'lights_off',
    );
    await type('Helper value', '', helper);
    await attempt();
    await check(
      'Helper number stays empty instead of becoming zero',
      input('Helper value', helper) +
        ".value==='' && document.activeElement===" +
        input('Helper value', helper),
    );
    await type('Helper value', '9', helper);
    await attempt();
    await check(
      'Helper numeric bounds are enforced',
      input('Helper value', helper) + ".getAttribute('aria-invalid')==='true'",
    );
    await type('Helper value', '4.5', helper);
    await cmd(labeled('Helper', 'button', helper), 'Review flag');
    await pick('Helper value', 'Off / false', helper);
    await cmd(labeled('Helper', 'button', helper), 'Review number');
    await check(
      'Changing helpers restores the authored numeric value',
      input('Helper value', helper) + ".value==='4.5'",
    );
    await save();
    assert(
      'Typed numeric helper write saves',
      (await current('helper')).value === 4.5,
    );
    await cmd(labeled('Helper', 'button', helper), 'Review flag');
    await pick('Helper value', 'Off / false', helper);
    await save();
    assert(
      'False helper value saves',
      (await current('helper')).value === false,
    );
    await cmd(labeled('Helper', 'button', helper), 'Review choice');
    await cmd(labeled('Helper value', 'button', helper), 'off');
    await save();
    assert(
      'Enum helper choice saves',
      (await current('helper')).value === 'off',
    );
    await cmd(labeled('Helper', 'button', helper), 'Review text');
    await type('Helper value', 'new text', helper);
    await save();
    assert(
      'Text helper value saves',
      (await current('helper')).value === 'new text',
    );
    await type('Helper value', '', helper);
    await save();
    assert(
      'Empty text helper value remains an empty string',
      (await current('helper')).value === '',
    );
    await check(
      'Helper reference opens its details page',
      labeled('Open helper details', 'a', helper) +
        ".getAttribute('href').includes(" +
        JSON.stringify(helperRows[3].id) +
        ')',
    );
    await cmd(labeled('Helper', 'button', helper), 'Review number');
    await check(
      'Fresh bounded helper default respects its minimum',
      input('Helper value', helper) + ".value==='2'",
    );
    await type('Helper value', '-', helper);
    await cmd(labeled('Helper', 'button', helper), 'Review flag');
    await save();
    assert(
      'Changing helper clears discarded numeric error',
      (await current('helper')).value === false,
    );
    await cmd(
      labeled('Select routine...', 'button', node('invoke')),
      'Kitchen daytime',
    );
    for (const [label, mode] of [
      ['Await completion', 'await_completion'],
      ['Fire and forget', 'fire_and_forget'],
    ]) {
      await pick('Invocation mode', label, node('invoke'));
      await save();
      assert(
        'Invocation mode saves: ' + mode,
        (await current('invoke')).mode === mode &&
          (await current('invoke')).routine_id === 'kitchen_day',
      );
    }
    await shot('helper');
    await reload();
    assert(
      'Saved action fields survive reload',
      (await current('dim')).transition_ms === 1001 &&
        (await current('helper')).value === false,
    );
    await check(
      'Phone and desktop action controls stay within page width',
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

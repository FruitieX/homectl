import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/routines';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `routine-timing-${width}-${Date.now()}`;
  const path = '/config/routines/' + id;
  const main = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' };
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
      execution: {
        mode: 'queued',
        max_actions: 16,
        min_interval_ms: 60000,
        future: 'kept',
      },
      program: {
        kind: 'native',
        steps: [
          {
            id: 'activate',
            action: 'activate_scene',
            scene_id: 'night',
            targets: {},
            use_scene_transition: true,
            transition_ms: 2000,
            rollout: {
              style: 'spatial',
              source: { kind: 'device', device: main, future: 'source-kept' },
              duration_ms: 1500,
              future: 'kept',
            },
          },
          {
            id: 'cycle',
            action: 'cycle_scenes',
            scenes: [
              {
                scene_id: 'normal',
                targets: {},
                use_scene_transition: true,
                transition_ms: 3000,
                future: 'first',
              },
              {
                scene_id: 'night',
                targets: {},
                use_scene_transition: true,
                transition_ms: 4000,
                future: 'second',
              },
            ],
            nowrap: false,
            detection: {},
            rollout: {
              style: 'spatial',
              source: { kind: 'triggering_device' },
              duration_ms: 1500,
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
      `/tmp/routine-timing-${width}-${state}.png`,
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
  const action = node('activate'),
    cycle = node('cycle');
  const input = (label, scope = 'document') => labeled(label, 'input', scope);
  const attempt = async () =>
    click('(' + button('Save changes') + ' || ' + button('Retry save') + ')');
  const steps = async () => (await read()).definition_v2.program.steps;
  const policy = async () => (await read()).definition_v2.execution;
  const options = async () => {
    if (!(await evaluate(action + ".querySelector('details').open")))
      await click(action + ".querySelector('summary')");
  };
  const cmd = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[cmdk-item]')", 'Device picker');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
        JSON.stringify(text) +
        '))',
    );
  };
  const entries =
    cycle +
    ".querySelectorAll(':scope > .space-y-3 > .space-y-2 > .space-y-2')";
  // Select cycle cards by their direct Scene N heading, independently of wrapper spacing.
  const entry = (index) =>
    '[...' +
    cycle +
    ".querySelectorAll('p')].find(e=>e.textContent.trim()==='Scene " +
    (index + 1) +
    "').parentElement.parentElement";
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until('!!' + input('Max actions'), 'Execution ready');
    await type('Max actions', '');
    await attempt();
    await check(
      'Clearing the action limit does not replace it with a default',
      input('Max actions') +
        ".value==='' && document.activeElement===" +
        input('Max actions'),
    );
    assert('An incomplete action limit sends no writes', writes === 0);
    await goto('/config/routines');
    await goto(path);
    await until('!!' + input('Max actions'), 'Retained policy');
    await check(
      'Unfinished policy fields survive navigation',
      input('Max actions') + ".value===''",
    );
    await click(button('Discard'));
    await check(
      'Discard restores the saved action limit',
      input('Max actions') + ".value==='16'",
    );
    for (const value of ['1.5', '65']) {
      await type('Max actions', value);
      await attempt();
      await check(
        'Invalid action limit stays visible: ' + value,
        input('Max actions') +
          '.value===' +
          JSON.stringify(value) +
          ' && ' +
          input('Max actions') +
          ".getAttribute('aria-invalid')==='true'",
      );
    }
    await type('Max actions', '32');
    await type('Minimum spacing', '0');
    await attempt();
    await check(
      'Zero rate limit is explained rather than silently removed',
      'document.activeElement===' +
        input('Minimum spacing') +
        " && document.body.textContent.includes('positive duration')",
    );
    await type('Minimum spacing', '');
    for (const [label, mode] of [
      ['Reject while pending', 'single'],
      ['Restart', 'restart'],
      ['Queue (default)', 'queued'],
    ]) {
      await pick('Execution mode', label);
      await save();
      const p = await policy();
      assert(
        'Execution mode persists: ' + mode,
        p.mode === mode &&
          p.max_actions === 32 &&
          !Object.hasOwn(p, 'min_interval_ms') &&
          p.future === 'kept',
      );
    }
    await pick('Minimum spacing unit', 'seconds');
    await type('Minimum spacing', '1.001');
    await pick('Minimum spacing unit', 'minutes');
    await save();
    assert(
      'Minimum spacing retains exact milliseconds across units',
      (await policy()).min_interval_ms === 1001,
    );
    await options();
    await pick('Transition source', 'Instant unless overridden', action);
    await type('Transition override', '0', action);
    await attempt();
    await check(
      'A zero override points to the instant alternative',
      'document.activeElement===' +
        input('Transition override', action) +
        " && document.body.textContent.includes('Choose instant')",
    );
    await type('Transition override', '', action);
    await type('Rollout spread', '2.75', action);
    await cmd(
      labeled('Select device...', 'button', action),
      'living_room_floor_lamp',
    );
    await pick('Rollout source', 'Triggering device', action);
    await pick('Rollout source', 'Fixed device', action);
    await check(
      'Rollout source switches retain the fixed device',
      action + ".textContent.includes('Floor lamp')",
    );
    await click(input('Spatial rollout', action));
    await click(input('Spatial rollout', action));
    await check(
      'Rollout off/on restores spread and source before Save',
      input('Rollout spread', action) +
        ".value==='2.75' && " +
        action +
        ".textContent.includes('Floor lamp')",
    );
    await save();
    let step = (await steps())[0];
    assert(
      'Rollout and explicit instant configuration persist without losing extensions',
      step.use_scene_transition === false &&
        !Object.hasOwn(step, 'transition_ms') &&
        step.rollout.duration_ms === 2750 &&
        step.rollout.source.device.device_id === 'living_room_floor_lamp' &&
        step.rollout.future === 'kept' &&
        step.rollout.source.future === 'source-kept',
    );
    await type('Rollout spread', '-', action);
    await goto('/config/routines');
    await goto(path);
    await until('!!' + input('Rollout spread', action), 'Retained rollout');
    await attempt();
    await check(
      'Save opens collapsed options and focuses their retained error',
      action +
        ".querySelector('details').open && document.activeElement===" +
        input('Rollout spread', action),
    );
    await click(input('Spatial rollout', action));
    await save();
    assert(
      'Disabling rollout drops its incomplete fields and saves omission',
      !Object.hasOwn((await steps())[0], 'rollout'),
    );
    await options();
    await click(input('Spatial rollout', action));
    await type('Rollout spread', '601', action);
    await attempt();
    await check(
      'Rollout duration is bounded at ten minutes',
      "document.body.textContent.includes('cannot exceed 10 minutes') && document.activeElement===" +
        input('Rollout spread', action),
    );
    await type('Rollout spread', '0', action);
    await save();
    assert(
      'Zero rollout is explicit immediate activation',
      (await steps())[0].rollout.duration_ms === 0,
    );
    await type('Rollout spread', '', action);
    await save();
    assert(
      'Missing rollout spread remains omitted',
      !Object.hasOwn((await steps())[0].rollout, 'duration_ms'),
    );
    await type('Transition override', '-', entry(1));
    await click(
      '[...' +
        entry(1) +
        ".querySelectorAll('button')].find(e=>e.textContent.trim()==='Move up')",
    );
    await check(
      'Cycle transition drafts follow their scene when reordered',
      input('Transition override', entry(0)) +
        ".value==='-' && " +
        entry(0) +
        ".textContent.includes('Night')",
    );
    await type('Transition override', '1.001', entry(0));
    await pick('Transition source', 'Instant unless overridden', entry(0));
    await save();
    step = (await steps())[1];
    assert(
      'Reordered cycle timing persists per scene with extension fields',
      step.scenes[0].scene_id === 'night' &&
        step.scenes[0].transition_ms === 1001 &&
        step.scenes[0].use_scene_transition === false &&
        step.scenes[0].future === 'second' &&
        step.scenes[1].transition_ms === 3000,
    );
    await type('Transition override', '-', entry(0));
    await click(
      '[...' +
        entry(0) +
        ".querySelectorAll('button')].find(e=>e.textContent.trim()==='Remove')",
    );
    await save();
    assert(
      'Removing a cycle entry clears its incomplete timing draft',
      (await steps())[1].scenes.length === 1 &&
        (await steps())[1].scenes[0].scene_id === 'normal',
    );
    await type('Rollout spread', '0', cycle);
    await save();
    assert(
      'Cycle rollout independently saves zero',
      (await steps())[1].rollout.duration_ms === 0,
    );
    await reload();
    await options();
    await click(labeled('Rollout source', 'button', action));
    await key('Escape', 27);
    await shot('rollout');
    await click(input('Max actions'));
    await shot('policy');
    assert(
      'Saved policy and action timing survive reload',
      (await policy()).min_interval_ms === 1001 &&
        (await steps())[1].rollout.duration_ms === 0,
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

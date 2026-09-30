import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/';
  const marker = await fetch(base + 'routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  const id = `selection-${width}-${Date.now()}`,
    helper = id + '-helper',
    path = '/config/routines/' + id;
  const main = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' },
    floor = { ...main, device_id: 'living_room_floor_lamp' };
  const routine = {
    id,
    name: 'Evening routine selection',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [{ id: 'manual-start', kind: 'manual' }],
      condition: { kind: 'literal', value: true },
      execution: { mode: 'queued', max_actions: 32 },
      program: {
        kind: 'native',
        steps: [
          {
            id: 'mapped',
            action: 'activate_scene',
            select: {
              kind: 'helper_enum',
              helper,
              mapping: { on: 'normal', obsolete: 'dark' },
              fallback_scene_id: 'night',
              future: 'kept',
            },
            targets: { future: 'scope-kept' },
            use_scene_transition: true,
          },
          {
            id: 'fixed',
            action: 'activate_scene',
            scene_id: 'night',
            targets: {},
            use_scene_transition: true,
          },
          {
            id: 'cycle',
            action: 'cycle_scenes',
            scenes: [
              {
                scene_id: 'normal',
                targets: { devices: [main, floor], groups: ['living_room'] },
                use_scene_transition: true,
                future: 'first',
              },
              {
                scene_id: 'dark',
                targets: { groups: ['kitchen'] },
                use_scene_transition: false,
                transition_ms: 2000,
                future: 'second',
              },
            ],
            nowrap: false,
            detection: { devices: [main], groups: ['living_room'] },
          },
          {
            id: 'timer',
            action: 'schedule_timer',
            timer: 'selection-review',
            delay_ms: 60000,
            capture_target_intents: {
              devices: [main, floor],
              groups: ['living_room', 'kitchen'],
              future: 'capture-kept',
            },
          },
        ],
      },
    },
  };
  const write = async (endpoint, method, body) => {
    const r = await fetch(base + endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error('Fixture request failed: ' + endpoint);
    return r;
  };
  await write('helpers/' + helper, 'PUT', {
    id: helper,
    name: 'Evening mode',
    kind: { kind: 'enum', options: ['on', 'off', '__proto__'] },
    initial_value: 'on',
    persistence: 'durable',
    hidden: false,
    create_only: true,
  });
  await write('routines', 'POST', routine);
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
  const pause = () => new Promise((r) => setTimeout(r, 140));
  const until = async (expr, name) => {
    for (let i = 0; i < 90; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const node = (id) => `document.querySelector('[data-node-id="${id}"]')`;
  const button = (text, scope = 'document') =>
    `[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label, scope = 'document') =>
    `${scope}?.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`;
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing '+${JSON.stringify(expr)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const choose = async (label, text) => {
    await click(labeled(label, node('mapped')));
    await until(`!!document.querySelector('[role=option]')`, 'Options');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const pick = async (expr, text) => {
    await click(expr);
    await until(`!!document.querySelector('[cmdk-item]')`, 'Picker');
    await click(
      `[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.trim().includes(${JSON.stringify(text)}))`,
    );
    await until(
      `(${expr})?.getAttribute('aria-expanded') !== 'true'`,
      'Picker stays closed after selection',
    );
  };
  const details = async () => {
    if (!(await evaluate(`${node('mapped')}.querySelector('details').open`)))
      await click(`${node('mapped')}.querySelector('summary')`);
  };
  const read = async () =>
    (await (await fetch(base + 'routines')).json()).data.find(
      (r) => r.id === id,
    );
  const save = async () => {
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'Saved');
    return (await read()).definition_v2.program.steps;
  };
  const checks = [];
  const check = (ok, name) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/routine-selection-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    await write('routines/' + id, 'DELETE');
    await write('helpers/' + helper, 'DELETE');
  };
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method === 'PUT' && request.url === base + 'routines/' + id)
      writes++;
  });
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${labeled('Scene for __proto__', node('mapped'))}`,
      'Helper options loaded',
    );
    check(
      await evaluate(
        `${node('mapped')}.textContent.includes("Not in the helper's current options")`,
      ),
      'Obsolete helper mappings stay visible for repair',
    );
    await pick(
      labeled('Scene for obsolete', node('mapped')),
      'Clear selection',
    );
    await click(labeled('Scene for off', node('mapped')));
    await until(`!!document.querySelector('[cmdk-input]')`, 'Mapping search');
    await cdp.send('Input.insertText', { text: 'Night' });
    await until(
      `document.querySelector('[cmdk-item][aria-selected=true]')?.textContent.includes('Night')`,
      'Keyboard match',
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      text: '\r',
      windowsVirtualKeyCode: 13,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await until(
      `${labeled('Scene for off', node('mapped'))}?.getAttribute('aria-expanded') === 'false'`,
      'Keyboard selection closed',
    );
    check(
      await evaluate(
        `${labeled('Scene for off', node('mapped'))}.textContent.includes('Night')`,
      ),
      'Keyboard search selects a mapping and closes the picker',
    );
    await pick(labeled('Scene for __proto__', node('mapped')), 'Dark');
    await pick(labeled('Fallback scene', node('mapped')), 'Movie');
    await choose('Dynamic scene selection', "Mirror a group's active scene");
    await pick(
      `${node('mapped')}.querySelector('[aria-label="Select group..."]')`,
      'Kitchen',
    );
    await pick(labeled('Fallback scene', node('mapped')), 'Normal');
    await click(button('Use a fixed scene', node('mapped')));
    await pick(labeled('Scene to activate', node('mapped')), 'Night');
    await details();
    await click(button('Use a dynamic selection', node('mapped')));
    check(
      await evaluate(
        `${labeled('Dynamic scene selection', node('mapped'))}.textContent.includes('Mirror') && ${labeled('Fallback scene', node('mapped'))}.textContent.includes('Normal') && ${node('mapped')}.textContent.includes('Kitchen')`,
      ),
      'Dynamic/fixed switching restores the previous group selection and fallback',
    );
    await choose('Dynamic scene selection', 'Map a helper value to a scene');
    check(
      await evaluate(
        `${labeled('Scene for off', node('mapped'))}.textContent.includes('Night') && ${labeled('Scene for __proto__', node('mapped'))}.textContent.includes('Dark') && ${labeled('Fallback scene', node('mapped'))}.textContent.includes('Movie')`,
      ),
      'Helper/group switching restores every mapping and its independent fallback',
    );
    await details();
    await pick(
      `${node('mapped')}.querySelector('[aria-label="Add devices…"]')`,
      'zigbee2mqtt/living_room_lamp',
    );
    await pick(
      `${node('mapped')}.querySelector('[aria-label="Add devices…"]')`,
      'zigbee2mqtt/living_room_floor_lamp',
    );
    await pick(
      `${node('mapped')}.querySelector('[aria-label="Add groups…"]')`,
      'Living room',
    );
    await pick(
      `${node('mapped')}.querySelector('[aria-label="Add groups…"]')`,
      'Kitchen',
    );
    await click(labeled('Open helper details', node('mapped')));
    await until(
      `location.pathname===${JSON.stringify('/config/helpers/' + helper)}`,
      'Helper details',
    );
    await click(
      `[...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(e=>e.pathname===${JSON.stringify(path)})`,
    );
    await until(
      `!!${labeled('Scene for off', node('mapped'))}`,
      'Routine draft returned',
    );
    check(
      writes === 0 &&
        (await evaluate(
          `${labeled('Scene for off', node('mapped'))}.textContent.includes('Night')`,
        )),
      'Related helper navigation retains the draft without writing configuration',
    );
    await click(labeled('Scene for off', node('mapped')));
    await shot('mapping-picker');
    if (width < 768) await click(labeled('Scene for off', node('mapped')));
    else {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Escape',
        windowsVirtualKeyCode: 27,
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        windowsVirtualKeyCode: 27,
      });
    }
    const capture = `[...${node('timer')}.querySelectorAll('label')].find(e=>e.textContent.includes('Freeze target intents'))?.querySelector('input[type=checkbox]')`;
    await pick(
      `${node('timer')}.querySelector('[aria-label="Add groups…"]')`,
      'Bedroom',
    );
    await click(
      `${node('timer')}.querySelector('a[href*=living_room_lamp]').parentElement.querySelector('button')`,
    );
    await click(capture);
    await click(capture);
    check(
      await evaluate(
        `!!${node('timer')}.querySelector('a[href*=living_room_floor_lamp]') && ${node('timer')}.textContent.includes('Bedroom') && !${node('timer')}.querySelector('a[href*=living_room_lamp]')`,
      ),
      'Turning timer capture off and back on restores every selected target',
    );
    let steps = await save();
    let mapped = steps.find((s) => s.id === 'mapped'),
      timer = steps.find((s) => s.id === 'timer');
    check(
      mapped.select.mapping.on === 'normal' &&
        mapped.select.mapping.off === 'night' &&
        Object.hasOwn(mapped.select.mapping, '__proto__') &&
        mapped.select.mapping.__proto__ === 'dark' &&
        !Object.hasOwn(mapped.select.mapping, 'obsolete') &&
        mapped.select.future === 'kept' &&
        mapped.select.fallback_scene_id === 'movie',
      'Save preserves all edited mappings, arbitrary option keys, fallback and unknown fields',
    );
    check(
      JSON.stringify(mapped.targets.devices) ===
        JSON.stringify([main, floor]) &&
        mapped.targets.groups.join(',') === 'living_room,kitchen' &&
        mapped.targets.future === 'scope-kept',
      'Multiple target devices and groups save without truncation or loss of extensions',
    );
    check(
      steps.find((s) => s.id === 'fixed').scene_id === 'night' &&
        JSON.stringify(timer.capture_target_intents) ===
          JSON.stringify({
            devices: [floor],
            groups: ['living_room', 'kitchen', 'bedroom'],
            future: 'capture-kept',
          }),
      'Selection state is isolated by node and edited timer targets persist completely',
    );
    await choose('Dynamic scene selection', "Mirror a group's active scene");
    await click(button('Discard'));
    check(
      await evaluate(
        `${labeled('Dynamic scene selection', node('mapped'))}.textContent.includes('Map a helper') && ${labeled('Scene for off', node('mapped'))}.textContent.includes('Night')`,
      ),
      'Discard restores the saved selection mode and mappings',
    );
    await click(capture);
    steps = await save();
    check(
      !Object.hasOwn(
        steps.find((s) => s.id === 'timer'),
        'capture_target_intents',
      ),
      'Saving capture disabled omits the optional target scope',
    );
    const entries = () =>
      `[...${node('cycle')}.querySelectorAll('p')].filter(e=>/^Scene [0-9]+$/.test(e.textContent)).map(e=>e.parentElement.parentElement)`;
    await pick(
      `${entries()}[0].querySelector('[aria-label="Select scene..."]')`,
      'Night',
    );
    await click(button('Move up', `${entries()}[1]`));
    await pick(
      `[...${node('cycle')}.querySelectorAll('[aria-label="Add devices…"]')].at(-1)`,
      'zigbee2mqtt/living_room_floor_lamp',
    );
    await pick(
      `[...${node('cycle')}.querySelectorAll('[aria-label="Add groups…"]')].at(-1)`,
      'Kitchen',
    );
    steps = await save();
    const cycle = steps.find((s) => s.id === 'cycle');
    check(
      JSON.stringify(cycle.detection.devices) ===
        JSON.stringify([main, floor]) &&
        cycle.detection.groups.join(',') === 'living_room,kitchen',
      'Cycle detection scope saves multiple devices and groups independently of entry targets',
    );
    check(
      cycle.scenes[0].scene_id === 'dark' &&
        cycle.scenes[0].transition_ms === 2000 &&
        cycle.scenes[0].future === 'second' &&
        cycle.scenes[1].scene_id === 'night' &&
        JSON.stringify(cycle.scenes[1].targets.devices) ===
          JSON.stringify([main, floor]),
      'Cycle reorder carries each scene scope, transition and unknown fields together',
    );
    await click(button('Remove', `${entries()}[0]`));
    await click(button('Add scene', node('cycle')));
    await pick(
      `${entries()}[1].querySelector('[aria-label="Select scene..."]')`,
      'Movie',
    );
    await pick(
      `${entries()}[1].querySelector('[aria-label="Add groups…"]')`,
      'Bedroom',
    );
    steps = await save();
    check(
      steps.find((s) => s.id === 'cycle').scenes.length === 2 &&
        steps.find((s) => s.id === 'cycle').scenes[1].scene_id === 'movie' &&
        steps.find((s) => s.id === 'cycle').scenes[1].targets.groups[0] ===
          'bedroom',
      'Cycle remove/add saves the full replacement collection',
    );
    const beforeEmpty = writes;
    await click(button('Remove', `${entries()}[0]`));
    await click(button('Remove', `${entries()}[0]`));
    check(
      await evaluate(
        `${node('cycle')}.textContent.includes('Add at least one scene to this cycle')`,
      ),
      'Empty cycle explains how to repair or remove the action',
    );
    await click(button('Save changes'));
    check(
      writes === beforeEmpty &&
        (await evaluate(
          `document.activeElement === ${button('Add scene', node('cycle'))}`,
        )),
      'Saving an empty cycle focuses Add scene without writing',
    );
    await shot('empty-cycle');
    await click(button('Discard'));
    check(
      await evaluate(
        `${entries()}.length===2 && !${node('cycle')}.textContent.includes('Add at least one scene to this cycle')`,
      ),
      'Discard restores the saved cycle and clears its empty-state message',
    );
    await click(labeled('Dynamic scene selection', node('mapped')));
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    check(
      await evaluate(
        `![...document.querySelectorAll('.flow-block input,.flow-block button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
      ),
      'Routine collection controls fit the viewport',
    );
    await shot('saved');
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(
      `${labeled('Scene for __proto__', node('mapped'))}?.textContent.includes('Dark')`,
      'Reloaded mappings and scene catalog',
    );
    check(
      await evaluate(
        `${labeled('Scene for __proto__', node('mapped'))}.textContent.includes('Dark') && !${node('timer')}.textContent.includes('Captured targets')`,
      ),
      'Saved mappings and omitted timer scope survive reload',
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    process.stderr.write(
      JSON.stringify(
        await evaluate(
          "({open:[...document.querySelectorAll('[aria-expanded=true]')].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent})),items:[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent)})",
        ),
      ) + '\n',
    );
    throw error;
  } finally {
    await cleanup();
  }
}

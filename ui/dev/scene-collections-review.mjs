import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/scenes';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const id = `scene-collections-${width}-${Date.now()}`,
    path = '/config/scenes/' + id;
  const main = 'zigbee2mqtt/living_room_lamp',
    floor = 'zigbee2mqtt/living_room_floor_lamp';
  const initial = {
    id,
    name: 'Evening collection review',
    hidden: false,
    script: null,
    group_states: {
      living_room: {
        power: false,
        brightness: 0.42,
        color: null,
        future: { keep: true },
      },
      kitchen: {},
    },
    group_state_order: ['living_room', 'kitchen'],
    device_states: {
      'missing/device': {
        power: false,
        brightness: 0.12,
        future: { keep: true },
      },
      [main]: {
        scene_id: 'normal',
        device_keys: ['missing/lamp'],
        group_keys: ['missing_room'],
        transition: null,
        future: 42,
      },
    },
  };
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initial),
  });
  if (!r.ok) throw Error('Fixture creation failed');
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
  const button = (text, scope = 'document') =>
    `[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const row = (id) =>
    `document.querySelector(${JSON.stringify(`[data-target-key="${id}"]`)})`;
  const labeled = (label) =>
    `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`;
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing click target: '+${JSON.stringify(expr)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const type = async (expr, text) => {
    await click(expr);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
      windowsVirtualKeyCode: 8,
    });
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const choose = async (expr, text) => {
    await click(expr);
    await until(`!!document.querySelector('[role=option]')`, 'Select opened');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const reference = async (expr, id) => {
    await click(expr);
    await until(`!!document.querySelector('[cmdk-item]')`, 'Reference opened');
    await click(
      `[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(${JSON.stringify(id)}))`,
    );
  };
  const menu = async (target, text) => {
    await click(`${row(target)}.querySelector('.scene-row-menu button')`);
    await until(`!!document.querySelector('[role=menuitem]')`, 'Row actions');
    await click(
      `[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const modal = `document.querySelector('[role=dialog]')`;
  const toggle = async (id) =>
    click(
      `[...${modal}.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(id)}))?.querySelector('input[type=checkbox]')`,
    );
  const read = async () =>
    (await (await fetch(base)).json()).data.find((s) => s.id === id);
  const save = async () => {
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'Saved');
    return read();
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
      `/tmp/scene-collections-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Cleanup failed');
  };
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('Living room behavior')}`, 'Scene ready');
    await choose(labeled('Living room behavior'), 'Follow device');
    await reference(
      `${row('living_room')}.querySelector('.scene-link-fields [role=combobox]')`,
      floor,
    );
    await type(labeled('Living room brightness multiplier'), '0.55');
    await choose(labeled('Living room behavior'), 'Set state');
    check(
      await evaluate(
        `${labeled('Living room power')}.textContent.trim()==='Off' && ${labeled('Living room brightness percent')}.value==='42'`,
      ),
      'Switching behavior restores the complete explicit-state draft',
    );
    await choose(labeled('Living room behavior'), 'Follow device');
    check(
      await evaluate(
        `${labeled('Living room brightness multiplier')}.value==='0.55'`,
      ),
      'Device-link variant retains the edited multiplier',
    );
    let saved = await save();
    check(
      saved.group_states.living_room.device_id === 'living_room_floor_lamp' &&
        saved.group_states.living_room.brightness === 0.55,
      'Edited device-link source and multiplier persist',
    );
    await choose(labeled('Living room behavior'), 'Set state');
    await choose(labeled('Living room power'), 'Default · On');
    await type(labeled('Living room brightness percent'), '0');
    await type(labeled('Living room fade seconds'), '0');
    saved = await save();
    check(
      !Object.hasOwn(saved.group_states.living_room, 'power') &&
        saved.group_states.living_room.brightness === 0 &&
        saved.group_states.living_room.transition === 0,
      'Omitted power and explicit zero brightness/fade remain distinct',
    );
    await choose(labeled('Living room behavior'), 'Follow scene');
    await reference(labeled('Living room source scene'), 'normal');
    await menu('living_room', 'Stored activation options');
    await click(button('0 devices', row('living_room')));
    await toggle(main);
    await toggle(floor);
    await click(button('Done', modal));
    await click(button('0 groups', row('living_room')));
    await toggle('living_room');
    await toggle('kitchen');
    await click(button('Done', modal));
    await type(labeled('Living room fade seconds'), '1.5');
    const before = writes;
    await click(
      `${row('living_room')}.querySelector('a[aria-label="Open Normal"]')`,
    );
    await until(`location.pathname==='/config/scenes/normal'`, 'Related scene');
    await click(
      `[...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(e=>e.pathname===${JSON.stringify(path)})`,
    );
    await until(`!!${labeled('Living room source scene')}`, 'Draft return');
    check(
      writes === before &&
        (await evaluate(
          `${row('living_room')}.textContent.includes('2 devices') && ${row('living_room')}.textContent.includes('2 groups')`,
        )),
      'Related scene navigation retains multiple scope entries without saving',
    );
    await click(labeled('Living room source scene'));
    await shot('picker');
    if (width < 768) await click(labeled('Living room source scene'));
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
    saved = await save();
    const link = saved.group_states.living_room;
    check(
      link.scene_id === 'normal' &&
        link.transition === 1.5 &&
        JSON.stringify(link.device_keys) === JSON.stringify([main, floor]) &&
        JSON.stringify(link.group_keys) === '["living_room","kitchen"]',
      'Edited scene link saves every scope member and transition',
    );
    await click(button('1 devices', row(main)));
    check(
      await evaluate(
        `${modal}.textContent.includes('missing/lamp') && ${modal}.textContent.includes('Unavailable')`,
      ),
      'Missing scope members are visible and removable',
    );
    await toggle('missing/lamp');
    await click(button('Cancel', modal));
    check(
      await evaluate(`!!${button('1 devices', row(main))}`),
      'Cancel leaves scope selection unchanged',
    );
    await click(button('1 devices', row(main)));
    await toggle('missing/lamp');
    await click(button('Done', modal));
    await click(button('1 groups', row(main)));
    await toggle('missing_room');
    await click(button('Done', modal));
    saved = await save();
    check(
      JSON.stringify(saved.device_states[main].device_keys) === '[]' &&
        JSON.stringify(saved.device_states[main].group_keys) === '[]' &&
        saved.device_states[main].transition === null &&
        saved.device_states[main].future === 42,
      'Explicit empty scopes preserve null and unknown fields',
    );
    await click(button('Use default scope', row(main)));
    saved = await save();
    check(
      !Object.hasOwn(saved.device_states[main], 'device_keys') &&
        !Object.hasOwn(saved.device_states[main], 'group_keys'),
      'Default scope omits the fields rather than storing empty arrays',
    );
    await choose(labeled('Living room behavior'), 'Set state');
    await menu('living_room', 'Remove target');
    await click(button('Add groups'));
    await toggle('living_room');
    await click(button('Done', modal));
    await choose(labeled('Living room behavior'), 'Follow scene');
    check(
      await evaluate(
        `${labeled('Living room source scene')}.textContent.includes('Choose')`,
      ),
      'Removing and readding a target clears its old behavior cache',
    );
    await choose(labeled('Living room behavior'), 'Set state');
    await click(button('Add devices'));
    await toggle(floor);
    await toggle('esphome/kitchen_counter');
    await click(button('Done', modal));
    saved = await save();
    check(
      Object.keys(saved.device_states).length === 4 &&
        Object.hasOwn(saved.device_states, floor) &&
        Object.hasOwn(saved.device_states, 'esphome/kitchen_counter'),
      'Multiple added device targets persist together',
    );
    await menu('kitchen', 'Move later');
    saved = await save();
    check(
      saved.group_state_order.join(',') === 'living_room,kitchen',
      'Group precedence moves independently of target values',
    );
    await menu(floor, 'Remove target');
    saved = await save();
    check(
      !Object.hasOwn(saved.device_states, floor) &&
        Object.hasOwn(saved.device_states, main),
      'Removing one target preserves the remaining targets',
    );
    await choose(
      `${row('missing/device')}.querySelector('.scene-mode-cell [role=combobox]')`,
      'Follow scene',
    );
    await reference(
      `${row('missing/device')}.querySelector('.scene-link-fields [role=combobox]')`,
      'normal',
    );
    await reference(
      `${row('missing/device')}.querySelector('.scene-row-extra [role=combobox]')`,
      floor,
    );
    await choose(
      `${row(floor)}.querySelector('.scene-mode-cell [role=combobox]')`,
      'Set state',
    );
    saved = await save();
    check(
      !Object.hasOwn(saved.device_states, 'missing/device') &&
        saved.device_states[floor].brightness === 0.12 &&
        saved.device_states[floor].power === false &&
        saved.device_states[floor].future.keep === true,
      'Replacing a missing target retains its inactive behavior draft and unknown fields',
    );
    await click(labeled('Living room behavior'));
    await shot('behavior');
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
        `![...document.querySelectorAll('.scene-target-row button,.scene-target-row input')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
      ),
      'Target controls fit the viewport',
    );
    await shot('saved');
    for (const target of Object.keys(saved.group_states))
      await menu(target, 'Remove target');
    for (const target of Object.keys(saved.device_states))
      await menu(target, 'Remove target');
    saved = await save();
    check(
      Object.keys(saved.group_states).length === 0 &&
        Object.keys(saved.device_states).length === 0 &&
        saved.group_state_order.length === 0,
      'Removing all targets saves empty maps and precedence without stale entries',
    );
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(
      `document.body.textContent.includes('Evening collection review') && !!${button('Add groups')}`,
      'Reloaded scene',
    );
    check(
      await evaluate(`!document.querySelector('.scene-target-row')`),
      'Empty scene survives a full page reload',
    );
    return { passed: true, checks };
  } finally {
    await cleanup();
  }
}

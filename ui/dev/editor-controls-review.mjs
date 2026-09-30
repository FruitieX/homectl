import { writeFile } from 'node:fs/promises';

/** Shared list and preference controls, using only the marked local fixture. */
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021';
  const marker = await fetch(origin + '/api/v1/config/sensors/catalog');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  let writes = 0;
  const exceptions = [],
    checks = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method !== 'GET' && request.url.startsWith(origin + '/api/'))
      writes++;
  });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
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
  const label = (name) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + name + '"]')})`;
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const key = async (name) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: name,
        ...(name === 'Enter'
          ? {
              windowsVirtualKeyCode: 13,
              ...(type === 'keyDown' ? { text: '\r' } : {}),
            }
          : {}),
      });
  };
  const activate = async (expr) => {
    await evaluate(`(${expr}).focus()`);
    await key('Enter');
    await pause();
  };
  const select = async (name, text) => {
    await activate(label(name));
    await until("!!document.querySelector('[role=option]')", 'Options open');
    const item = `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    await until(`!!(${item})`, 'Named option');
    // Radix items receive keyboard focus; cmdk uses the active descendant.
    if (await evaluate(`(${item}).hasAttribute('cmdk-item')`)) {
      await evaluate(`document.querySelector('[cmdk-input]').focus()`);
      await cdp.send('Input.insertText', { text });
      await pause();
      await key('ArrowDown');
      await key('Enter');
    } else await activate(item);
    await until("!document.querySelector('[role=option]')", 'Selection closes');
    await pause();
  };
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const shot = async (name) => {
    await pause();
    await pause();
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/editor-controls-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  let commands = 0;
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const data = JSON.parse(response.payloadData);
      if (data.DeviceCommand || data.SceneCommand || data.Action) commands++;
    } catch {}
  });
  const field = (name) =>
    `document.querySelector(${JSON.stringify('[data-field="' + name + '"]')})`;
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/scenes/normal' });
    await until(`!!${field('group_states/living_room/color')}`, 'Scene loaded');
    const before = await evaluate(
      `${field('group_states/living_room/color')}.textContent`,
    );
    await activate(field('group_states/living_room/color'));
    await select('Color mode', 'Not specified');
    await check(
      'Empty scene color remains an explicit choice',
      `${label('Color mode')}.textContent==='Not specified'`,
    );
    await activate(button('Cancel'));
    await check(
      'Cancel restores original scene color',
      `${field('group_states/living_room/color')}.textContent===${JSON.stringify(before)} && !${button('Discard')}`,
    );
    await activate(field('group_states/living_room/color'));
    // Choose a named capability actually offered by the room targets.
    await select('Color mode', 'Colour temperature');
    await shot('scene-color');
    await activate(button('Apply color'));
    await until(`!!${button('Discard')}`, 'Scene draft applied');
    await check(
      'Apply changes the page draft only',
      `${field('group_states/living_room/color')}.textContent!==${JSON.stringify(before)}`,
    );
    await activate(button('Discard'));
    await until(`!${button('Discard')}`, 'Scene discarded');
    await goto('/config/routines/motion_on');
    await until(`!!${button('Preview draft')}`, 'Routine loaded');
    await activate(button('Preview draft'));
    await activate(button('Add assumed value'));
    await select('Assumed value', 'False');
    await check(
      'Boolean assumption retains False',
      `${label('Assumed value')}.textContent==='False'`,
    );
    await select('Assumption value type', 'Number');
    await check(
      'Numeric assumption starts with its correct value',
      "document.querySelector('[aria-label=\"Assumption 1\"] input[type=number]').value==='0'",
    );
    await select('Assumption value type', 'JSON');
    await check(
      'JSON assumption has a visible valid starting value',
      "[...document.querySelectorAll('[aria-label=\"Assumption 1\"] input')].some(e=>e.value==='null')",
    );
    await select('Assumption value type', 'On / off');
    await check(
      'Returning to boolean shows the new default',
      `${label('Assumed value')}.textContent==='True'`,
    );
    await shot('routine-preview');
    await goto('/config/floorplan?id=ground_floor');
    await until("!!document.querySelector('canvas')", 'Floorplan loaded');
    await activate(
      "[...document.querySelectorAll('[aria-label=\"Floorplan tools\"] button')].find(e=>e.textContent==='Rooms & groups')",
    );
    await until(`!!${label('Room to paint')}`, 'Room picker loaded');
    const roomBefore = await evaluate(`${label('Room to paint')}.textContent`);
    await activate(label('Room to paint'));
    await evaluate("document.querySelector('[cmdk-input]').focus()");
    await cdp.send('Input.insertText', { text: 'Living room' });
    await pause();
    await key('Escape');
    await until(
      "!document.querySelector('[cmdk-input]')",
      'Room search closed',
    );
    await check(
      'Searching without selection never changes the room to paint',
      `${label('Room to paint')}.textContent===${JSON.stringify(roomBefore)}`,
    );
    await select('Room to paint', 'Living room');
    await check(
      'Explicit room selection updates the paint target',
      `${label('Room to paint')}.textContent==='Living room'`,
    );
    await check(
      'Floorplan toolbar fits without squeezing its description',
      `document.documentElement.scrollWidth <= innerWidth + 1 && [...document.querySelectorAll('.settings-section-heading p')].every(e=>e.getBoundingClientRect().width>=160)`,
    );
    await shot('floorplan-rooms');
    await activate(
      "[...document.querySelectorAll('[aria-label=\"Floorplan tools\"] button')].find(e=>e.textContent==='Devices')",
    );
    await select('Placement device type', 'Sensors');
    await select('Placement room filter', 'Living room');
    await check(
      'Placement filters compose without editing the map',
      `${label('Placement room filter')}.textContent==='Living room' && ${label('Placement device type')}.textContent==='Sensors' && !${button('Discard')}`,
    );
    await select('Placement room filter', 'Clear selection');
    await check(
      'Clearing room filter retains the device type',
      `${label('Placement device type')}.textContent==='Sensors'`,
    );
    await evaluate(
      "document.querySelector('[aria-label=\"Device labels\"]').closest('details').open=true",
    );
    await select('Device labels', 'Hidden');
    await until(`!!${button('Discard')}`, 'Label draft');
    await check(
      'Label changes require Save',
      `${label('Device labels')}.textContent==='Hidden'`,
    );
    await activate(button('Discard'));
    await until(`!${button('Discard')}`, 'Label discarded');
    await goto('/groups/living_room');
    await until(`!!${button('Adjust together')}`, 'Room loaded');
    await activate(button('Adjust together'));
    await until(`!!${label('Apply controls to')}`, 'Selection overlay');
    await select('Apply controls to', 'Living room lamp');
    await check(
      'Live controls scope selects the named device',
      `${label('Apply controls to')}.textContent==='Living room lamp'`,
    );
    await select('Apply controls to', 'All 2 selected devices');
    await check(
      'Live scope can return to the original selection',
      `${label('Apply controls to')}.textContent==='All 2 selected devices'`,
    );
    await shot('control-scope');
    await key('Escape');
    await pause();
    await goto('/groups');
    await activate(button('All devices'));
    await until(`!!${label('Device type')}`, 'Everyday device filter');
    await select('Device type', 'Sensors');
    await check(
      'Everyday filter uses the shared selector',
      `${label('Device type')}.textContent==='Sensors'`,
    );
    await check(
      'Page fits its viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    if (writes || commands || exceptions.length)
      throw Error(JSON.stringify({ writes, commands, exceptions }));
    checks.push({
      name: 'Selection and local drafts send no writes or live commands',
      passed: true,
    });
    return {
      passed: true,
      checks,
      scope: 'Marked local fixture; all configuration drafts discarded',
    };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await goto('/config');
  }
}

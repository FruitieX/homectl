import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/helpers';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `helper-review-${width}-${Date.now()}`;
  const path = '/config/helpers/' + id;
  const initial = {
    id,
    name: 'Review helper',
    kind: { kind: 'enum', options: ['on', 'off', 'away'] },
    initial_value: 'off',
    persistence: 'durable',
  };
  const created = await fetch(base + '/' + id, {
    method: 'PUT',
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
    commands = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
    if (request.url === base + '/' + id + '/value' && request.method === 'PUT')
      commands++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/helper-editor-${width}-${state}.png`,
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
  const choose = async (label, text) => {
    await click(labeled(label, 'button'));
    await until(`!!document.querySelector('[cmdk-item]')`, 'Choice options');
    await click(
      `[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const save = async (reset = false) => {
    await click(button('Save changes'));
    if (reset) {
      await until(`!!${button('Save and reset value')}`, 'Reset confirmation');
      await click(button('Save and reset value'));
    }
    await until(`!${button('Discard')}`, 'Definition acknowledged');
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(`!!${labeled('Helper type', 'button')}`, 'Helper reloaded');
  };
  try {
    // Seed a current value that differs from the definition's initial value.
    await fetch(base + '/' + id + '/value', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'away' }),
    });
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('Helper type', 'button')}`, 'Helper ready');
    await click(labeled('Move option 3 up', 'button'));
    await click(labeled('Move option 2 down', 'button'));
    await check(
      'Options move in both directions',
      `${labeled('Option 3', 'input')}.value==='away'`,
    );
    await type('Option 2', 'on');
    await click(button('Save changes'));
    assert('Duplicate enum choices cannot be saved', writes === 0);
    await type('Option 2', 'off');
    await click(labeled('Remove option 2', 'button'));
    await check(
      'Removing the initial choice shows an immediate repair message',
      `document.querySelector('[data-field=initial_value]').textContent.includes('Choose one of the available options') && ${labeled('Initial value', 'button')}.textContent.includes('unavailable')`,
    );
    await click(button('Save changes'));
    assert('Unavailable initial value blocks saving', writes === 0);
    await choose('Initial value', 'on');
    await save();
    assert(
      'Definition save leaves a valid current value intact',
      (await read()).value === 'away' &&
        (await read()).initial_value === 'on' &&
        commands === 0,
    );
    await click(labeled('Remove option 2', 'button'));
    const before = writes;
    await click(button('Save changes'));
    await until(
      `!!${button('Save and reset value')}`,
      'Current-value reset review',
    );
    await shot('reset-review');
    await click(button('Cancel'));
    assert(
      'Cancelling a reset issues no definition or live-value write',
      writes === before && commands === 0 && (await read()).value === 'away',
    );
    await click(button('Retry save'));
    await until(`!!${button('Save and reset value')}`, 'Reset review returns');
    await click(button('Save and reset value'));
    await until(`!${button('Discard')}`, 'Reset saved');
    assert(
      'Explicitly confirmed definition reset uses its initial value',
      (await read()).value === 'on' && commands === 0,
    );
    await click(labeled('Remove option 1', 'button'));
    await click(button('Save changes'));
    assert(
      'Empty enum stays unsaved and repairable',
      JSON.stringify((await read()).kind.options) === '["on"]',
    );
    await click(button('Add option'));
    await type('Option 1', 'on');
    await check(
      'Restoring the saved list clears its dirty state',
      `!${button('Discard')}`,
    );
    await click(button('Add option'));
    await type('Option 2', 'off');
    await save();
    await type('Helper name', 'Unsaved name');
    await choose('Current helper value', 'off');
    assert(
      'Editing a current value is not an immediate command',
      commands === 0 && (await read()).value === 'on',
    );
    await click(button('Set current value'));
    await until(
      `document.querySelector('#current').textContent.includes('Current value updated.')`,
      'Command acknowledged',
    );
    assert(
      'Live command preserves the unsaved definition',
      commands === 1 &&
        (await read()).value === 'off' &&
        (await read()).name === initial.name,
    );
    await check(
      'Definition draft remains visible after a live command',
      `${labeled('Helper name', 'input')}.value==='Unsaved name' && !!${button('Discard')}`,
    );
    await click(button('Discard'));
    await pick('Helper type', 'Number (bounded)');
    await type('Minimum', '-10');
    await type('Maximum', '10');
    await type('Initial value', '0');
    await pick('Helper type', 'String');
    await type('Initial value', 'remember');
    await pick('Helper type', 'Number (bounded)');
    await check(
      'Type switches retain numeric bounds and zero',
      `${labeled('Minimum', 'input')}.value==='-10' && ${labeled('Maximum', 'input')}.value==='10' && ${labeled('Initial value', 'input')}.value==='0'`,
    );
    await goto('/config/helpers');
    await goto(path);
    await until(`!!${labeled('Minimum', 'input')}`, 'Number draft returned');
    await type('Minimum', '11');
    await click(button('Save changes'));
    assert(
      'Reversed bounds do not change the saved type',
      (await read()).kind.kind === 'enum',
    );
    await type('Minimum', '-10');
    await type('Initial value', '');
    await click(button('Save changes'));
    assert(
      'Empty numeric initial value cannot become zero implicitly',
      (await read()).kind.kind === 'enum',
    );
    await type('Initial value', '0');
    await save(true);
    assert(
      'Number zero and edited bounds persist',
      (await read()).initial_value === 0 &&
        (await read()).kind.min === -10 &&
        (await read()).kind.max === 10,
    );
    await type('Minimum', '');
    await type('Maximum', '');
    await save();
    assert(
      'Cleared optional bounds are omitted',
      !Object.hasOwn((await read()).kind, 'min') &&
        !Object.hasOwn((await read()).kind, 'max'),
    );
    await pick('Helper type', 'Boolean');
    await pick('Initial value', 'Off / false');
    await save(true);
    assert(
      'Boolean false persists',
      (await read()).initial_value === false && (await read()).value === false,
    );
    await pick('Helper type', 'String');
    await type('Initial value', '');
    await pick('Persistence', 'Session — resets on restart');
    await save(true);
    assert(
      'Empty text and session persistence survive save',
      (await read()).initial_value === '' &&
        (await read()).persistence === 'session',
    );
    await reload();
    await check(
      'Saved empty text survives reload',
      `${labeled('Initial value', 'input')}.value==='' && ${labeled('Persistence', 'button')}.textContent.includes('Session')`,
    );
    await pick('Helper type', 'Enum (fixed options)');
    await click(button('Add option'));
    await type('Option 3', 'away');
    await click(labeled('Move option 3 up', 'button'));
    await click(labeled('Helper type', 'button'));
    await shot('types');
    await key('Escape', 27);
    await check(
      'Helper controls fit the viewport',
      `![...document.querySelectorAll('#type input,#type button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
    );
    await click(button('Discard'));
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

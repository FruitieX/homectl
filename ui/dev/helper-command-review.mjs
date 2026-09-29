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
  const id = `helper-command-${width}-${Date.now()}`;
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
      `/tmp/helper-command-${width}-${state}.png`,
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
  let attempts = 0,
    heldId;
  let release;
  const pendingRequest = new Promise((resolve) => {
    release = resolve;
  });
  cdp.on('Fetch.requestPaused', async ({ requestId }) => {
    attempts++;
    if (attempts === 1)
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({
            success: false,
            error: 'Simulated helper command failure.',
          }),
        ).toString('base64'),
      });
    else {
      heldId = requestId;
      release();
    }
  });
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${labeled('Current helper value', 'button')}`,
      'Current helper control',
    );
    await type('Helper name', 'Uncommitted definition');
    await choose('Current helper value', 'on');
    await cdp.send('Fetch.enable', {
      patterns: [
        { urlPattern: base + '/' + id + '/value', requestStage: 'Request' },
      ],
    });
    await click(button('Set current value'));
    await until(
      `document.querySelector('#current [role=alert]')?.textContent.includes('Simulated helper command failure')`,
      'Command rejection shown',
    );
    assert(
      'Failed command leaves the saved value unchanged',
      (await read()).value === 'off',
    );
    await check(
      'Failed command retains the selected value and definition draft',
      `${labeled('Current helper value', 'button')}.textContent.trim()==='on' && ${labeled('Helper name', 'input')}.value==='Uncommitted definition'`,
    );
    await click(button('Set current value'));
    await pendingRequest;
    await check(
      'Pending command locks its value control and shows pending status',
      `${labeled('Current helper value', 'button')}.disabled && ${button('Setting…')}?.disabled && !document.querySelector('#current [role=status]')`,
    );
    assert(
      'Pending command does not claim a changed server value',
      (await read()).value === 'off',
    );
    await shot('pending');
    await cdp.send('Fetch.continueRequest', { requestId: heldId });
    heldId = undefined;
    await until(
      `document.querySelector('#current [role=status]')?.textContent.includes('Current value updated.')`,
      'Command acknowledgement',
    );
    assert(
      'Acknowledged retry changes only the live value',
      (await read()).value === 'on' &&
        (await read()).name === initial.name &&
        writes === 0 &&
        commands === 2,
    );
    await check(
      'Command acknowledgement keeps the definition draft',
      `${labeled('Helper name', 'input')}.value==='Uncommitted definition' && !!${button('Discard')}`,
    );
    await click(button('Discard'));
    return { passed: true, checks, expectedHttpErrors: [503] };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
    await cleanup();
  }
}

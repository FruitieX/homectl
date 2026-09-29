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
  const id = `mqtt-recovery-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'mqtt',
    enabled: false,
    config: {
      host: 'fixture.invalid',
      port: 1883,
      mode: 'generic',
      topic: 'fixture/{id}',
      topic_set: 'fixture/{id}/set',
      sensor_value_fields: ['/temperature', '/humidity'],
      disabled_device_ids: ['offline', 'unused'],
      managed: { Partial: { prev_change_committed: false, future: 0 } },
      retain_commands: null,
      capabilities_override: {
        brightness: false,
        ct: { start: 2300, end: 6100 },
      },
      password: 'fixture-only-original',
      future: { keep: [false, 0, null] },
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
      `/tmp/mqtt-recovery-${width}-${state}.png`,
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
  let rejectNext = true;
  cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
    if (request.method === 'PUT' && rejectNext) {
      rejectNext = false;
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 500,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({
            success: false,
            error:
              'Integration reload failed: simulated fixture connection refusal.',
          }),
        ).toString('base64'),
      });
    } else await cdp.send('Fetch.continueRequest', { requestId });
  });
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('Host', 'input')}`, 'Integration ready');
    await pick('Missing-report warnings', 'Expect regular reports');
    await type('Expected reporting interval (seconds)', '3600');
    await pick('Missing-report warnings', 'Ignore missing reports');
    await pick('Missing-report warnings', 'Expect regular reports');
    await check(
      'Reporting selector retains the custom interval',
      `${labeled('Expected reporting interval (seconds)', 'input')}.value==='3600'`,
    );
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: base + '/' + id, requestStage: 'Request' }],
    });
    await type('Host', 'retry.fixture.invalid');
    await click(button('Save changes'));
    await until(`!!${button('Retry save')}`, 'Failure is retryable');
    await check(
      'Rejected save keeps the edited field and explicit error',
      `${labeled('Host', 'input')}.value==='retry.fixture.invalid' && document.querySelector('.settings-save-errors')?.textContent.includes('Integration reload failed') && !!${button('Discard')}`,
    );
    assert(
      'Failed save does not change the stored integration',
      (await read()).config.host === initial.config.host,
    );
    await shot('failed');
    await click(button('Retry save'));
    await until(`!${button('Discard')}`, 'Retried save acknowledged');
    assert(
      'Retry saves the retained draft',
      (await read()).config.host === 'retry.fixture.invalid',
    );
    await check(
      'Successful retry clears the error',
      `!document.querySelector('.settings-save-errors')`,
    );
    assert(
      'Reporting policy is saved with the retry',
      (await read()).reporting_policy.expected_interval_seconds === 3600,
    );
    await pick('Missing-report warnings', 'Ignore missing reports');
    await save();
    assert(
      'Ignore policy persists explicitly',
      (await read()).reporting_policy.mode === 'ignore',
    );
    await pick('Missing-report warnings', 'Use integration behavior');
    await save();
    assert(
      'Integration behavior restores inheritance',
      (await read()).reporting_policy.mode === 'inherit',
    );
    await reload();
    await check(
      'Acknowledged retry survives page reload',
      `${labeled('Host', 'input')}.value==='retry.fixture.invalid' && !${button('Discard')}`,
    );
    return { passed: true, checks, expectedHttpErrors: [500] };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
    await cleanup();
  }
}

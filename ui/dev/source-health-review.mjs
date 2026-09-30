import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/sources';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `source-health-${width}-${Date.now()}`;
  const path = '/config/sources/' + id;
  const preset = (
    await (await fetch(origin + '/api/v1/config/source-presets')).json()
  ).data[0];
  if (!preset) throw Error('Fixture preset metadata missing');
  const initial = {
    id,
    name: 'Failed daylight source',
    enabled: true,
    revision: 1,
    timezone: 'Europe/Helsinki',
    refresh_interval_ms: 60000,
    aliases: [],
    compute: {
      kind: 'script',
      preset: { id: 'circadian', version: 1 },
      params: preset.default_params,
    },
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
    for (let i = 0; i < 150; i++) {
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
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/source-health-${width}-${state}.png`,
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
    await click(button('Save changes'));
    await until(`!${button('Discard')}`, 'Source saved');
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(
      `!!${labeled('Computation type', 'button')}`,
      'Source reloaded',
    );
  };

  const deviceKey = 'computed/' + id;
  const message =
    'Failed daylight source could not compute a fresh value: Missing daylight parameter.';
  let failReads = false,
    hasFailure = true;
  const health = () => ({
    evaluated_at_ms: Date.now(),
    warming_up: false,
    attention_device_keys: hasFailure ? [deviceKey] : [],
    devices: {
      [deviceKey]: {
        device_key: deviceKey,
        integration_id: 'computed',
        name: initial.name,
        status: hasFailure ? 'error' : 'waiting',
        last_fresh_report_ms: null,
        last_cached_report_ms: null,
        expected_by_ms: null,
        effective_policy: {
          source: 'automatic',
          policy: { mode: 'custom', expected_interval_seconds: 60 },
          description: 'Integration refresh cadence',
          scheduling_grace_seconds: 6,
        },
        issues: hasFailure ? [{ code: 'source_error', message }] : [],
      },
    },
  });
  const diagnostics = () => ({
    warming_up: false,
    issues: hasFailure
      ? [
          {
            id: 'source-first-failure',
            severity: 'warning',
            entity: 'source',
            entity_id: id,
            name: initial.name,
            code: 'source_error',
            message,
            suggestion:
              'Review the computed source and its most recent evaluation error.',
            device_keys: [deviceKey],
          },
        ]
      : [],
  });
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Fetch.requestPaused', async (event) => {
    const isHealth = event.request.url.endsWith('/device-health');
    await cdp.send('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: isHealth && failReads ? 503 : 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(
        JSON.stringify(
          isHealth && failReads
            ? { success: false, error: 'Fixture health read failed' }
            : { success: true, data: isHealth ? health() : diagnostics() },
        ),
      ).toString('base64'),
    });
  });
  const link = (href) =>
    `[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')===${JSON.stringify(href)} && a.getBoundingClientRect().width>0)`;
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: origin + '/api/v1/config/device-health' },
      { urlPattern: origin + '/api/v1/config/diagnostics' },
    ],
  });
  try {
    await cdp.send('Page.navigate', { url: origin + '/config' });
    await cdp.send('Page.bringToFront');
    await until(
      "document.body.textContent.includes('1 source needs attention')",
      'Source attention count',
    );
    await check(
      'Source without an output is counted once and links to its editor',
      `!!${link(path)} && !!${link('/config/diagnostics')}`,
    );
    await shot('overview');
    await click(link(path));
    await until(
      `location.pathname===${JSON.stringify(path)} && document.body.textContent.includes(${JSON.stringify(message)})`,
      'Source error detail',
    );
    await check(
      'Failure is explained without inventing an output device',
      `document.body.textContent.includes('No output received yet') && !${link('/config/devices/' + encodeURIComponent(deviceKey))}`,
    );
    await check(
      'Source error links to canonical device-key logs',
      `!!${link('/config/logs?device=' + encodeURIComponent(deviceKey))}`,
    );
    await shot('failure');
    await click("document.querySelector('input[data-field=name]')");
    await key('a', 65, 2);
    await key('Backspace', 8);
    await cdp.send('Input.insertText', { text: 'Retained repair draft' });
    failReads = true;
    await until(
      "document.body.textContent.includes('Source health is unavailable.')",
      'Health read error',
    );
    await check(
      'Failed health read keeps source draft',
      "document.querySelector('input[data-field=name]').value==='Retained repair draft'",
    );
    await shot('read-failed');
    failReads = false;
    await click(button('Retry health'));
    await until(
      `document.body.textContent.includes(${JSON.stringify(message)}) && !document.body.textContent.includes('Source health is unavailable.')`,
      'Health read recovers',
    );
    await check(
      'Retry restores error evidence without discarding edits',
      "document.querySelector('input[data-field=name]').value==='Retained repair draft'",
    );
    await goto('/config/diagnostics');
    await until(
      "document.body.textContent.includes('Open source')",
      'Source diagnostic',
    );
    await check(
      'Diagnostics use the source editor and canonical related logs',
      `!!${link(path)} && !!${link('/config/logs?device=' + encodeURIComponent(deviceKey))}`,
    );
    await click(link(path));
    await until(
      "!!document.querySelector('input[data-field=name]')",
      'Returned source',
    );
    await check(
      'Diagnostic return retains draft',
      "document.querySelector('input[data-field=name]').value==='Retained repair draft'",
    );
    await click(button('Discard'));
    await goto('/config/sources');
    await until(`!!${link(path)}`, 'Source catalog');
    await check(
      'Source catalog includes runtime error evidence',
      `${link(path)}.textContent.includes(${JSON.stringify(message)})`,
    );
    await click(link(path));
    hasFailure = false;
    await until(
      `!document.body.textContent.includes(${JSON.stringify(message)})`,
      'Old failure cleared',
    );
    await check(
      'A cleared error does not invent a successful value',
      "document.body.textContent.includes('No output received yet')",
    );
    assert('Health review performs no configuration writes', writes === 0);
    assert('No page exceptions', exceptions.length === 0);
    return {
      passed: true,
      checks,
      scope:
        'Owned fixture source with intercepted health and diagnostics; no source execution',
    };
  } catch (error) {
    await shot('test-failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
    await cleanup();
  }
}

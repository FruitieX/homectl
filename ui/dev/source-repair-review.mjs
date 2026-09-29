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
  const id = `source-repair-${width}-${Date.now()}`;
  const path = '/config/sources/' + id;
  const preset = (
    await (await fetch(origin + '/api/v1/config/source-presets')).json()
  ).data[0];
  if (!preset) throw Error('Fixture preset metadata missing');
  const initial = {
    id,
    name: 'Source review',
    enabled: false,
    revision: 0,
    timezone: 'Europe/Helsinki',
    refresh_interval_ms: 60000,
    aliases: null,
    compute: {
      kind: 'script',
      preset: { id: 'circadian', version: 99 },
      params: [0, null, { future: false }],
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
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/source-repair-${width}-${state}.png`,
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
  const script = async (text) => {
    await until(
      `!!document.querySelector('#script .monaco-editor textarea')`,
      'Script editor ready',
    );
    await click(`document.querySelector('#script .monaco-editor textarea')`);
    await key('a', 65, 2);
    await cdp.send('Input.insertText', { text });
    await pause();
  };
  const body =
    'return { value: { brightness: 0.25 } }; // retained custom draft';
  let previews = 0;
  cdp.on('Fetch.requestPaused', async ({ requestId }) => {
    previews++;
    if (previews <= 2)
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: previews === 1 ? 200 : 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify(
            previews === 1
              ? {
                  success: true,
                  data: {
                    timezone: 'Europe/Helsinki',
                    samples: [],
                    step_ms: 0,
                    day_start_ms: 0,
                    unsupported_reason: null,
                  },
                }
              : { success: false, error: 'Simulated preview failure.' },
          ),
        ).toString('base64'),
      });
    else await cdp.send('Fetch.continueRequest', { requestId });
  });
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${labeled('Computation type', 'button')}`,
      'Unknown preset ready',
    );
    await check(
      'Unknown preset stays explicit without the known-version form',
      `${labeled('Computation type', 'button')}.textContent.includes('Unavailable preset: circadian · v99') && !document.querySelector('#profile') && ${labeled('Parameters 1', 'input')}.value==='0'`,
    );
    await check(
      'Malformed alias value stays visible for explicit repair',
      `${labeled('Aliases value type', 'button')}.textContent.includes('None')`,
    );
    await type('Parameters 1', '7');
    await goto('/config/sources');
    await goto(path);
    await until(
      `!!${labeled('Parameters 1', 'input')}`,
      'Unknown preset draft returns',
    );
    await check(
      'Unknown-preset parameters survive navigation',
      `${labeled('Parameters 1', 'input')}.value==='7'`,
    );
    assert(
      'Inspecting unknown data does not normalize the stored values',
      writes === 0 &&
        (await read()).compute.preset.version === 99 &&
        (await read()).aliases === null,
    );
    await click(labeled('Computation type', 'button'));
    await shot('unknown');
    await key('Escape', 27);
    await pick('Aliases value type', 'List');
    await pick('Computation type', 'Custom JavaScript');
    await save();
    let saved = await read();
    assert(
      'Explicit conversion preserves opaque parameters and repairs aliases',
      saved.compute.kind === 'script' &&
        !saved.compute.preset &&
        typeof saved.compute.source_body === 'string' &&
        JSON.stringify(saved.compute.params) === '[7,null,{"future":false}]' &&
        JSON.stringify(saved.aliases) === '[]',
    );
    await reload();
    assert(
      'Repaired opaque parameters survive reload',
      JSON.stringify((await read()).compute.params) ===
        '[7,null,{"future":false}]',
    );
    await pick('Computation type', 'Circadian · v1');
    await save();
    await reload();
    await click(button('Copy to custom script'));
    await save();
    assert(
      'Fork copies the exact shipped body and parameters without a preset pin',
      (await read()).compute.source_body === preset.source_body &&
        JSON.stringify((await read()).compute.params) ===
          JSON.stringify(preset.default_params) &&
        !Object.hasOwn((await read()).compute, 'preset'),
    );
    const before = writes;
    await click(button('Preview draft'));
    await until(
      `document.querySelector('#preview')?.textContent.includes('Custom script previews are unavailable')`,
      'Unsupported preview explanation',
    );
    await check(
      'Unsupported preview does not invent a chart',
      `!document.querySelector('[aria-label="Light profile preview"]')`,
    );
    await cdp.send('Fetch.enable', {
      patterns: [
        {
          urlPattern: origin + '/api/v1/config/source-preview',
          requestStage: 'Request',
        },
      ],
    });
    await click(button('Refresh preview'));
    await until(
      `document.querySelector('#preview').textContent.includes('The preview returned no samples.')`,
      'Empty preview explanation',
    );
    await shot('empty');
    await check(
      'Empty result differs from unsupported computation',
      `!document.querySelector('#preview').textContent.includes('Custom script previews are unavailable')`,
    );
    await click(button('Refresh preview'));
    await until(
      `document.querySelector('#preview').textContent.includes('Simulated preview failure.')`,
      'Preview failure',
    );
    await check(
      'Failed preview clears old empty results and keeps Retry available',
      `!document.querySelector('#preview').textContent.includes('The preview returned no samples.') && !!${button('Refresh preview')}`,
    );
    await click(button('Refresh preview'));
    await until(
      `document.querySelector('#preview').textContent.includes('Custom script previews are unavailable')`,
      'Preview retry',
    );
    await check(
      'Successful retry clears the preview error',
      `!document.querySelector('#preview').textContent.includes('Simulated preview failure.')`,
    );
    assert('Every preview is read-only', writes === before);
    await reload();
    assert(
      'Forked custom definition survives reload',
      (await read()).compute.source_body === preset.source_body,
    );
    return { passed: true, checks, expectedHttpErrors: [503] };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
    await cleanup();
  }
}

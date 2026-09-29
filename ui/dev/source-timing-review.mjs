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
  const id = `source-timing-${width}-${Date.now()}`;
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
    aliases: [],
    compute: {
      kind: 'circadian_compat',
      preset_version: 1,
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
      `/tmp/source-timing-${width}-${state}.png`,
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
    await until(
      `!!${labeled('Computation type', 'button')}`,
      'Source reloaded',
    );
  };

  let previews = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url.endsWith('/source-preview') && request.method === 'POST')
      previews++;
  });
  const inputValue = (label) => labeled(label, 'input') + '.value';
  const focused = (label) =>
    'document.activeElement === ' + labeled(label, 'input');
  const attempt = async () => {
    await click(
      '(' + button('Save changes') + ' || ' + button('Retry save') + ')',
    );
    await pause();
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until('!!' + labeled('day fade duration', 'input'), 'Profile ready');
    await type('Refresh interval (seconds)', '');
    await attempt();
    await check(
      'Blank refresh stays blank and receives validation focus',
      inputValue('Refresh interval (seconds)') +
        " === '' && " +
        focused('Refresh interval (seconds)'),
    );
    assert('Invalid refresh sends no writes', writes === 0);
    await goto('/config/sources');
    await goto(path);
    await until(
      '!!' + labeled('Refresh interval (seconds)', 'input'),
      'Retained draft ready',
    );
    await check(
      'Unfinished refresh survives navigation',
      inputValue('Refresh interval (seconds)') + " === ''",
    );
    await click(button('Discard'));
    await check(
      'Discard restores saved refresh',
      inputValue('Refresh interval (seconds)') +
        ' === ' +
        JSON.stringify(String(initial.refresh_interval_ms / 1000)),
    );
    await type('Refresh interval (seconds)', '1.0001');
    await attempt();
    await check(
      'Sub-millisecond refresh is explained and focused',
      focused('Refresh interval (seconds)') +
        " && document.body.textContent.includes('whole milliseconds')",
    );
    await type('Refresh interval (seconds)', '1.001');
    await save();
    assert(
      'Fractional seconds persist as exactly 1001 milliseconds',
      (await read()).refresh_interval_ms === 1001,
    );
    await click(button('Preview draft'));
    await until('!!' + labeled('Light profile preview'), 'Valid preview ready');
    const beforePreviews = previews,
      beforeWrites = writes;
    await type('day fade duration', '-');
    await attempt();
    await check(
      'Incomplete duration stays editable and receives focus',
      inputValue('day fade duration') +
        " === '-' && " +
        focused('day fade duration'),
    );
    await check(
      'Preview blocks invalid draft and marks retained chart as stale',
      button('Refresh preview') +
        ".disabled && document.querySelector('#preview').textContent.includes('Complete the invalid profile fields') && document.querySelector('#preview').textContent.includes('changed')",
    );
    assert(
      'Invalid duration sends neither a save nor a preview',
      writes === beforeWrites && previews === beforePreviews,
    );
    await shot('unfinished');
    await type('day fade duration', '1.5');
    await attempt();
    await check(
      'Fractional hours remain visible with whole-hour guidance',
      inputValue('day fade duration') +
        " === '1.5' && document.body.textContent.includes('whole hours')",
    );
    await type('day fade duration', '15');
    await attempt();
    await check(
      'Overlapping fades focus the night start',
      focused('night fade starts') +
        " && document.body.textContent.includes('night fade must start after')",
    );
    await type('day fade duration', '2');
    await type('night fade duration', '4');
    await attempt();
    await check(
      'A fade ending at midnight focuses its duration',
      focused('night fade duration') +
        " && document.body.textContent.includes('finish before midnight')",
    );
    await type('night fade duration', '2');
    await type('day brightness', '101');
    await attempt();
    await check(
      'Out-of-range brightness remains visible and focused',
      inputValue('day brightness') +
        " === '101' && " +
        focused('day brightness'),
    );
    await type('day brightness', '0');
    await type('night brightness', '');
    await save();
    let saved = await read();
    assert(
      'Zero brightness and an omitted endpoint persist distinctly',
      saved.compute.params.day_brightness === 0 &&
        !Object.hasOwn(saved.compute.params, 'night_brightness'),
    );
    await type('day fade duration', '');
    await pick('Computation type', 'Circadian · v1');
    await check(
      'Inactive unfinished fields do not leak errors into another computation',
      "!document.querySelector('[aria-invalid=true]') && !!" +
        button('Save changes'),
    );
    await pick('Computation type', 'Built-in circadian');
    await check(
      'Returning to a computation retains its last valid values',
      inputValue('day fade duration') +
        " === '2' && " +
        inputValue('day brightness') +
        " === '0' && " +
        inputValue('night brightness') +
        " === ''",
    );
    await type('day fade duration', '3');
    await save();
    await reload();
    await check(
      'Saved timing and optional brightness survive reload',
      inputValue('Refresh interval (seconds)') +
        " === '1.001' && " +
        inputValue('day fade duration') +
        " === '3' && " +
        inputValue('day brightness') +
        " === '0' && " +
        inputValue('night brightness') +
        " === ''",
    );
    await click(button('Preview draft'));
    await until(
      '!!' + labeled('Light profile preview'),
      'Repaired preview ready',
    );
    await check(
      'Chart and time labels remain readable at this viewport',
      `(() => {
        const chart = ${labeled('Light profile preview')};
        const labels = [...chart.parentElement.querySelectorAll('span')];
        return chart.getBoundingClientRect().height >= 144 && labels.length === 4 &&
          labels.every(label => parseFloat(getComputedStyle(label).fontSize) >= 12);
      })()`,
    );
    await shot('saved');
    assert(
      'Repaired profile can be previewed again',
      previews > beforePreviews,
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

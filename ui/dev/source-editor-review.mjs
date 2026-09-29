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
  const id = `source-review-${width}-${Date.now()}`;
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
    aliases: ['legacy/one', 'legacy/two'],
    compute: {
      kind: 'circadian_compat',
      preset_version: 1,
      params: {
        ...preset.default_params,
        gain: 12,
        future: { keep: [false, 0, null] },
      },
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
      `/tmp/source-editor-${width}-${state}.png`,
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
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('Computation type', 'button')}`, 'Source editor');
    await type('day brightness', '0');
    await type('Alias 2', 'legacy/one');
    await click(button('Save changes'));
    assert('Duplicate aliases cannot be saved', writes === 0);
    await type('Alias 2', 'legacy/two');
    await click(labeled('Remove alias 1', 'button'));
    await click(button('Add alias'));
    await type('Alias 2', 'legacy/three');
    await type('gain', '');
    await check(
      'Incomplete parameter number remains editable',
      `${labeled('gain', 'input')}.value==='' && ${labeled('gain', 'input')}.getAttribute('aria-invalid')==='true'`,
    );
    await pick('Computation type', 'Custom JavaScript');
    await pick('Computation type', 'Built-in circadian');
    await check(
      'Computation switch clears inactive numeric errors and restores its values',
      `${labeled('gain', 'input')}.value==='12' && !document.querySelector('input[aria-invalid=true]') && ${labeled('day brightness', 'input')}.value==='0'`,
    );
    await type('gain', '34');
    await save();
    let saved = await read();
    assert(
      'Built-in settings preserve zero, edited aliases and unknown parameters',
      saved.compute.params.day_brightness === 0 &&
        saved.compute.params.gain === 34 &&
        JSON.stringify(saved.compute.params.future) ===
          '{"keep":[false,0,null]}' &&
        JSON.stringify(saved.aliases) === '["legacy/two","legacy/three"]',
    );
    await pick('Computation type', 'Circadian · v1');
    await type('day brightness', '45');
    await save();
    saved = await read();
    assert(
      'Preset identity and edited params persist without an inline body',
      saved.compute.preset.id === 'circadian' &&
        saved.compute.preset.version === 1 &&
        saved.compute.params.day_brightness === 0.45 &&
        !Object.hasOwn(saved.compute, 'source_body'),
    );
    await reload();
    await click(button('Copy to custom script'));
    await script(body);
    await pick('Parameters value type', 'List');
    await click(
      `[...document.querySelectorAll('#parameters button')].find(e=>e.textContent.trim()==='Add item')`,
    );
    await pick('Parameters 1 value type', 'Number');
    await type('Parameters 1', '0');
    await pick('Computation type', 'Circadian · v1');
    await check(
      'Existing custom draft has an explicit return action',
      `!!${button('Return to custom draft')}`,
    );
    await click(button('Return to custom draft'));
    await check(
      'Returning to custom retains its parameter list',
      `${labeled('Parameters 1', 'input')}.value==='0'`,
    );
    await save();
    saved = await read();
    assert(
      'Custom body and list params persist without a preset pin',
      saved.compute.source_body === body &&
        JSON.stringify(saved.compute.params) === '[0]' &&
        !Object.hasOwn(saved.compute, 'preset'),
    );
    await pick('Parameters value type', 'None (null)');
    await save();
    assert(
      'Explicit null params persist',
      (await read()).compute.params === null,
    );
    await reload();
    await pick('Parameters value type', 'Fields');
    await type('New Parameters field name', 'gain');
    await click(
      `[...document.querySelectorAll('#parameters button')].find(e=>e.textContent.trim()==='Add field')`,
    );
    await pick('gain value type', 'Number');
    await type('gain', '7');
    await pick('Computation type', 'Built-in circadian');
    await pick('Computation type', 'Custom JavaScript');
    await check(
      'Custom object parameters survive type switching',
      `${labeled('gain', 'input')}.value==='7'`,
    );
    await goto('/config/sources');
    await goto(path);
    await until(`!!${labeled('gain', 'input')}`, 'Parameter draft restored');
    await check(
      'Navigation retains the custom parameter draft',
      `${labeled('gain', 'input')}.value==='7'`,
    );
    await click(button('Discard'));
    await check(
      'Discard restores stored null params',
      `${labeled('Parameters value type', 'button')}.textContent.includes('None')`,
    );
    await pick('Computation type', 'Built-in circadian');
    await save();
    const before = writes;
    await pick('Preview sample count', '24 samples');
    await click(button('Preview draft'));
    await until(
      `!!document.querySelector('[aria-label="Light profile preview"]')`,
      'Draft preview',
    );
    await type('day brightness', '30');
    await check(
      'Preview shows when its inputs became stale',
      `document.querySelector('#preview').textContent.includes('Draft changed.')`,
    );
    assert(
      'Preview and editing issue no configuration save',
      writes === before,
    );
    await click(labeled('Preview sample count', 'button'));
    await shot('preview-options');
    await key('Escape', 27);
    await click(button('Discard'));
    await click(labeled('Remove alias 1', 'button'));
    await click(labeled('Remove alias 1', 'button'));
    await save();
    await reload();
    assert(
      'All aliases can be removed and stay empty after reload',
      JSON.stringify((await read()).aliases) === '[]',
    );
    await click(labeled('Computation type', 'button'));
    await shot('types');
    await key('Escape', 27);
    await check(
      'Source controls fit the viewport',
      `![...document.querySelectorAll('#compute button,#aliases input,#aliases button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}

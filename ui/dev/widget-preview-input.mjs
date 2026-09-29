export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const press = async (key, code, number) => {
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: number,
      text: key === 'Enter' ? '\r' : undefined,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: number,
    });
  };
  const marker = await evaluate(
    `fetch('/api/v1/config/dashboard/layouts').then(r=>r.headers.get('x-homectl-fixture'))`,
  );
  if (marker !== 'true') throw Error('Marked fixture required');
  await evaluate(
    `window.__previewWrites=[]; window.__previewFetch=window.fetch; window.fetch=(...args)=>{if(String(args[0]).includes('/api/v1/config/') && args[1]?.method && !['GET','HEAD'].includes(args[1].method.toUpperCase())) window.__previewWrites.push(String(args[0])); return window.__previewFetch(...args)};`,
  );
  const find = (name) =>
    `[...document.querySelectorAll('[aria-label="Widget type"] button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(name)}))`;
  const checks = [];
  for (const name of [
    'Rooms',
    'Scenes',
    'Indoor climate',
    'Controls',
    'Timers',
    'Mode / helper',
    'Home overview',
    'Clock',
    'Weather',
    'Sensors',
    'Spot Price',
    'Train Schedule',
    'Text',
    'Image',
    'Link',
    'Iframe',
    'Custom HTML',
  ]) {
    await evaluate(`${find(name)}.focus()`);
    await press('Enter', 'Enter', 13);
    await pause(250);
    const state = await evaluate(
      `({selected:${find(name)}.getAttribute('aria-pressed'), failed:document.querySelector('#widget-preview').textContent.includes('could not be previewed'), card:!!document.querySelector('#widget-preview .dashboard-widget-container'), overflow:document.documentElement.scrollWidth>innerWidth+1})`,
    );
    if (
      state.selected !== 'true' ||
      state.failed ||
      !state.card ||
      state.overflow
    )
      throw Error(name + ': ' + JSON.stringify(state));
    checks.push(
      name + ' selects with keyboard and renders without page overflow',
    );
  }
  const set = async (selector, value) =>
    evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await evaluate(`${find('Iframe')}.click()`);
  await pause(200);
  await set('#widget-options input[aria-label="Iframe URL"]', 'about:blank');
  await pause(200);
  if (
    (await evaluate(
      `document.querySelector('#widget-preview iframe')?.getAttribute('sandbox')`,
    )) !== ''
  )
    throw Error('Embedded preview can execute scripts');
  checks.push('Embedded preview disables script execution');
  await evaluate(`${find('Rooms')}.click()`);
  await pause(200);
  await evaluate(
    `document.querySelector('[data-field="grid_w"]').closest('details').open=true`,
  );
  await set('[data-field="grid_w"]', '');
  await pause(200);
  const box = await evaluate(
    `(()=>{const b=document.querySelector('#widget-preview [inert]').getBoundingClientRect(); return {width:b.width,height:b.height,text:document.querySelector('#widget-preview').textContent}})()`,
  );
  if (
    !(box.width > 0 && box.height > 0) ||
    box.text.includes('could not be previewed')
  )
    throw Error('Invalid draft dimensions break preview');
  checks.push('Incomplete dimensions keep a finite preview');
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Create widget').click()`,
  );
  await pause(300);
  if (
    !(await evaluate(`location.pathname.endsWith('/new')`)) ||
    (await evaluate(`window.__previewWrites.length`)) !== 0
  )
    throw Error('Invalid draft wrote configuration');
  checks.push('Invalid dimensions block creation');
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Standard').click()`,
  );
  await pause(200);
  const inertFocus = await evaluate(
    `(()=>{const e=document.querySelector('#widget-preview [inert] button, #widget-preview [inert] a'); e?.focus(); return !e||document.activeElement!==e})()`,
  );
  if (!inertFocus) throw Error('Preview accepts keyboard focus');
  if ((await evaluate(`window.__previewWrites.length`)) !== 0)
    throw Error('Preview wrote configuration');
  checks.push(
    'Preview controls cannot receive keyboard focus; configuration is untouched',
  );
  await evaluate(
    `window.fetch=window.__previewFetch; document.querySelector('#widget-preview').scrollIntoView({block:'start'})`,
  );
  return { passed: true, checks };
}

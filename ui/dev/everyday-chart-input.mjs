import { readFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Isolated fixture required');
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
  const seeded = await evaluate(
    await readFile(
      new URL('./everyday-widgets-journey.js', import.meta.url),
      'utf8',
    ),
  );
  if (!seeded.passed) throw Error('Widget seed failed');
  const pause = () => new Promise((r) => setTimeout(r, 220));
  const until = async (fn, msg) => {
    for (let i = 0; i < 80; i++) {
      if (await fn()) return;
      await pause();
    }
    throw Error(msg);
  };
  await evaluate(
    `document.querySelector('[aria-label="Open Indoor climate details"]').click()`,
  );
  await until(
    () =>
      evaluate(
        `!!document.querySelector('[role="dialog"] svg[role="slider"]')`,
      ),
    'Chart detail',
  );
  const selector = '[role="dialog"] svg[role="slider"]';
  const checks = [];
  const key = async (k, code = k) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code,
      windowsVirtualKeyCode:
        { Home: 36, End: 35, Escape: 27, ArrowRight: 39 }[k] ?? 0,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
    await pause();
  };
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await key('Home');
  const first = await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuetext')`,
  );
  await key('End');
  const last = await evaluate(
    `document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-valuetext')`,
  );
  if (first === last || !last.includes('Living climate'))
    throw Error('Keyboard chart readings did not change');
  checks.push('Native Home/End expose dated readings and source labels');
  await key('Escape');
  if (
    !(await evaluate(
      `!!document.querySelector('[role="dialog"]') && !document.querySelector('[aria-label="Close chart reading"]')`,
    ))
  )
    throw Error('Escape should dismiss reading before detail');
  checks.push('Escape dismisses the reading without closing its detail');
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  const point = await evaluate(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.blur();e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width*0.65,y:r.y+r.height*0.45};})()`,
  );
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [point],
  });
  await pause();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await pause();
  if (
    !(await evaluate(
      `!!document.querySelector('[aria-label="Close chart reading"]')`,
    ))
  )
    throw Error('Touch reading disappeared on release');
  checks.push('Native touch reading remains after releasing the finger');
  await evaluate(
    `document.querySelector('[aria-label="Close chart reading"]').click()`,
  );
  await pause();
  if (
    await evaluate(
      `!!document.querySelector('[aria-label="Close chart reading"]')`,
    )
  )
    throw Error('Reading did not dismiss');
  checks.push('Touch reading has a working explicit close');
  await evaluate(
    `document.querySelector('[role="dialog"] button[aria-label="Close"]').click()`,
  );
  await until(
    () => evaluate(`!document.querySelector('[role="dialog"]')`),
    'Close detail',
  );
  await evaluate(`document.documentElement.style.zoom='2'`);
  await pause();
  if (
    !(await evaluate(
      'document.documentElement.scrollWidth<=document.documentElement.clientWidth+1',
    ))
  )
    throw Error('Dashboard overflows at 200% zoom');
  checks.push('Dashboard remains within the viewport at 200% zoom');
  await evaluate(`document.documentElement.style.zoom=''`);
  await pause();
  return { passed: true, checks, width, layout: seeded.layout };
}

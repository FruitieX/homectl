import { writeFile } from 'node:fs/promises';
export default async function (cdp, { url, width }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const marker = await fetch('http://127.0.0.1:3021/api/v1/config/logs');
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
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
  const pause = () => new Promise((r) => setTimeout(r, 160));
  const until = async (e, name) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(e)) return;
      await pause();
    }
    throw Error(name);
  };
  const checks = [];
  const check = async (name, e) => {
    if (!(await evaluate(e))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const key = async (key, code) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      windowsVirtualKeyCode: code,
      ...(key === 'Enter' ? { text: '\r' } : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: code,
    });
    await pause();
  };
  const pick = async (label, text) => {
    await evaluate(`document.querySelector('[aria-label="${label}"]').focus()`);
    await key('Enter', 13);
    await until(`!!document.querySelector('[role="option"]')`, 'Select open');
    await evaluate(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent===${JSON.stringify(text)}).click()`,
    );
    await pause();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const rows = Array.from({ length: 500 }, (_, i) => ({
    timestamp: new Date(Date.now() + i * 1000).toISOString(),
    level: i % 2 ? 'WARN' : 'INFO',
    target: i % 2 ? 'all' : 'homectl::fixture',
    message:
      i === 499
        ? 'Window light has not reported since 16:42:05; expected within 30 minutes. ' +
          'Full message details. '.repeat(20)
        : `Fixture log message ${i}`,
    references:
      i === 499
        ? [
            {
              entity: 'device',
              entity_id: 'zigbee2mqtt/living_room_lamp',
              label: 'Window light',
            },
          ]
        : [],
  }));
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `const logFetch=window.fetch.bind(window);window.fetch=(input,init)=>String(input).endsWith('/config/logs')?Promise.resolve(new Response(JSON.stringify({success:true,data:${JSON.stringify(rows)}}),{status:200,headers:{'Content-Type':'application/json'}})):logFetch(input,init);`,
  });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3021/config/logs' });
  await cdp.send('Page.bringToFront');
  await until(
    `document.querySelectorAll('.settings-log-row').length===200`,
    'Bounded initial rows',
  );
  checks.push({
    name: 'Initial 500-entry buffer renders only 200 rows',
    passed: true,
  });
  await check(
    width >= 768
      ? 'Desktop log rows are at most 32px high'
      : 'Phone log rows wrap without horizontal overflow',
    width >= 768
      ? `[...document.querySelectorAll('.settings-log-row')].every(e=>e.getBoundingClientRect().height<=32)`
      : `document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.log-message').clientHeight>18`,
  );
  await evaluate(`document.querySelector('.settings-log-row').focus()`);
  await key('Enter', 13);
  await until(`!!document.querySelector('[role="dialog"]')`, 'Full message');
  await check(
    'Keyboard opens complete message and canonical device link',
    `document.querySelector('[role="dialog"] pre').textContent===${JSON.stringify(rows[499].message)}&&[...document.querySelectorAll('[role="dialog"] a')].some(a=>decodeURIComponent(a.href).includes('/config/devices/detail/zigbee2mqtt/living_room_lamp'))`,
  );
  await key('Escape', 27);
  await until(`!document.querySelector('[role="dialog"]')`, 'Close log');
  await check(
    'Escape restores focus to the original row',
    `document.activeElement.classList.contains('settings-log-row')`,
  );
  await pick('Log source', 'all');
  await check(
    'A source named all remains a distinct URL filter',
    `new URLSearchParams(location.search).get('source')==='all'&&document.body.textContent.includes('250')`,
  );
  await pick('Log source', 'All sources');
  await pick('Log level', 'INFO');
  await check(
    'Level filter updates URL and rows',
    `new URLSearchParams(location.search).get('level')==='INFO'&&[...document.querySelectorAll('.log-level')].every(e=>e.textContent==='INFO')`,
  );
  await pick('Log level', 'All levels');
  await evaluate(`${button('Show more (300 remaining)')}.click()`);
  await pause();
  await check(
    'Show more adds the next bounded page',
    `document.querySelectorAll('.settings-log-row').length===400`,
  );
  await evaluate(`${button('Show more (100 remaining)')}.click()`);
  await pause();
  await check(
    'Final page stops at the available buffer',
    `document.querySelectorAll('.settings-log-row').length===500`,
  );
  await evaluate('window.scrollTo(0,0)');
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`/tmp/log-density-${width}.png`, Buffer.from(data, 'base64'));
  return { passed: true, checks, width };
}

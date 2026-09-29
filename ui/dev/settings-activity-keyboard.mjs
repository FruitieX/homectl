export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/config/routine-history'))
    throw Error('Use the isolated fixture.');
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  if (
    (await evaluate(
      "fetch('/api/v1/config/routine-history').then(r=>r.headers.get('x-homectl-fixture'))",
    )) !== 'true'
  )
    throw Error('Fixture marker missing');
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const key = async (key, code = key) => {
    const windowsVirtualKeyCode = key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0;
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
    });
    await pause();
  };
  await evaluate(
    "document.querySelector('[data-activity-id] summary').focus()",
  );
  await key('Enter');
  if (!(await evaluate("document.querySelector('[data-activity-id]').open")))
    throw Error('Keyboard did not open evidence');
  await key('Tab');
  if (
    !(await evaluate(
      "document.activeElement.tagName==='A' && document.activeElement.textContent==='Open routine'",
    ))
  )
    throw Error('Evidence link not next in tab order');
  await evaluate(
    "document.querySelector('[data-activity-id] summary').focus()",
  );
  await key('Enter');
  if (await evaluate("document.querySelector('[data-activity-id]').open"))
    throw Error('Keyboard did not close evidence');
  await evaluate(
    "document.documentElement.style.zoom='2';document.querySelector('h1').scrollIntoView({block:'start'})",
  );
  await pause();
  if (
    !(await evaluate(
      'document.documentElement.scrollWidth<=document.documentElement.clientWidth',
    ))
  )
    throw Error('Page overflow at 200% zoom');
  if (
    !(await evaluate(
      "[...document.querySelectorAll('[data-activity-id] summary')].every(row => row.scrollWidth <= row.clientWidth)",
    ))
  )
    throw Error('Activity row clipped at 200% zoom');
  await evaluate(
    "document.querySelector('[data-activity-id] summary').focus()",
  );
  await key('Enter');
  if (!(await evaluate("document.querySelector('[data-activity-id]').open")))
    throw Error('Evidence unavailable at 200% zoom');
  return {
    passed: true,
    checks: [
      'Native Enter opens and closes evidence',
      'Related links follow the summary in keyboard order',
      'Activity remains usable at 200% CSS zoom without horizontal page overflow',
    ],
  };
}

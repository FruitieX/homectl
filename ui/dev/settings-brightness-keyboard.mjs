export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/config/devices/detail/'))
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
      "fetch('/api/v1/config/calibration-editor').then(r=>r.headers.get('x-homectl-fixture'))",
    )) !== 'true'
  )
    throw Error('Fixture marker missing');
  const before = await evaluate(
    "fetch('/api/v1/config/calibration-editor').then(r=>r.json()).then(r=>r.data.revision_token)",
  );
  const pause = () => new Promise((resolve) => setTimeout(resolve, 180));
  const key = async (key, code = key, modifiers = 0) => {
    const windowsVirtualKeyCode =
      { Enter: 13, Tab: 9, ' ': 32, a: 65, Backspace: 8 }[key] ?? 0;
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
      modifiers,
      ...(key === 'Enter'
        ? { text: '\r', unmodifiedText: '\r' }
        : key === ' '
          ? { text: ' ', unmodifiedText: ' ' }
          : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
    });
    await pause();
  };
  const buttonFocus = async (label) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).focus()`,
    );
  await evaluate(
    "[...document.querySelectorAll('[aria-label=\"Brightness calibration\"] label')].find(e=>e.textContent.includes('Enter a curve manually')).querySelector('input').focus()",
  );
  await key(' ', 'Space');
  if (!(await evaluate('document.activeElement.checked')))
    throw Error('Native Space did not select manual mode');
  await buttonFocus('Continue');
  await key('Enter');
  await evaluate(
    'document.querySelector(\'[aria-label="Target output for point 2"]\').focus()',
  );
  await key('a', 'KeyA', 2);
  await key('Backspace');
  if (
    !(await evaluate(
      "document.querySelector('[aria-label=\"Target output for point 2\"]').value==='' && [...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Review').disabled",
    ))
  )
    throw Error('Empty native input was not retained');
  await cdp.send('Input.insertText', { text: '60' });
  await pause();
  await key('Tab');
  await key('Enter');
  if (
    (await evaluate(
      'document.querySelector(\'[aria-label="Target output for point 2"]\').value',
    )) !== '59'
  )
    throw Error('Keyboard step button did not adjust the point');
  await evaluate(
    "document.documentElement.style.zoom='2';document.querySelector('[aria-label=\"Brightness calibration\"]').scrollIntoView({block:'start'})",
  );
  await pause();
  if (
    !(await evaluate(
      'document.documentElement.scrollWidth<=document.documentElement.clientWidth',
    ))
  )
    throw Error('Page overflow at 200% CSS zoom');
  if (
    !(await evaluate(
      '[...document.querySelectorAll(\'[aria-label="Brightness calibration"] input\')].every(e=>e.getBoundingClientRect().right<=innerWidth+1)',
    ))
  )
    throw Error('Point inputs clipped at 200% CSS zoom');
  await buttonFocus('Review');
  await key('Enter');
  await buttonFocus('Discard');
  await key('Enter');
  if (
    !(await evaluate(
      "document.querySelector('[aria-label=\"Brightness calibration\"]').textContent.includes('How do you want to work?')",
    ))
  )
    throw Error('Keyboard Discard did not restore the initial draft');
  if (
    (await evaluate(
      "fetch('/api/v1/config/calibration-editor').then(r=>r.json()).then(r=>r.data.revision_token)",
    )) !== before
  )
    throw Error('Keyboard navigation wrote configuration');
  return {
    passed: 4,
    checks: [
      'Native radio and numeric editing retain intermediate input',
      'Tab/Enter operates brightness step controls',
      '200% CSS enlargement keeps inputs in view',
      'Keyboard Discard restores the draft without configuration writes',
    ],
  };
}
